"""
自主探索执行服务

工作流：
1. 模型发现（model-discovery skill）
2. 质量评估（model-evaluation skill）
3. 代码分析（code-analysis skill）
4. 报告生成（report-generation skill）
5. 持久化与状态更新
"""
from __future__ import annotations

import importlib.util
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from backend.app.core.settings import settings
from backend.app.db import get_db
from backend.app.db.repositories import AppSettingsRepository
from backend.app.db.models import DiscoveredModel, ExplorationReport, ExplorationTask
from backend.app.services.exploration.agent import ExplorationReportAgent
from backend.app.services.exploration.markdown_formatter import (
    normalize_bullet_item,
    to_markdown_text,
)
from backend.app.services.exploration.report_renderer import render_professional_report
from backend.app.services.notification.notification_service import NotificationService

logger = logging.getLogger(__name__)


DEFAULT_EXPLORATION_MONITOR_SOURCES = ["github", "huggingface", "modelscope", "arxiv"]
DEFAULT_EXPLORATION_WATCH_ORGS = [
    "openai",
    "anthropic",
    "google-deepmind",
    "meta-llama",
    "mistralai",
    "deepseek-ai",
    "qwen",
    "zhipuai",
]
ALLOWED_EXPLORATION_SOURCES = {"github", "huggingface", "arxiv", "modelscope"}


class ExplorationService:
    """自主探索任务执行引擎"""

    def __init__(self) -> None:
        self.db = get_db()
        self.skills_root = Path(__file__).resolve().parents[2] / "skills"
        self._callable_cache: Dict[str, Callable[..., Any]] = {}

    def run_task(
        self,
        task_id: str,
        sources: List[str],
        min_score: float = 70.0,
        days_back: int = 7,
        max_results_per_source: int = 30,
        keywords: Optional[List[str]] = None,
        watch_organizations: Optional[List[str]] = None,
        run_mode: str = "auto",
    ) -> None:
        """
        执行完整探索任务
        """
        execution_mode = self._resolve_execution_mode(run_mode)
        self._set_task_running(task_id, sources, execution_mode=execution_mode)

        try:
            discovered_models, source_counts = self._discover_models(
                sources=sources,
                days_back=days_back,
                max_results_per_source=max_results_per_source,
                keywords=keywords,
                watch_organizations=watch_organizations,
            )
            updates_detected = sum(
                1
                for item in discovered_models
                if (item.get("extra_data") or {}).get("update_type")
            )
            self._set_task_progress(
                task_id,
                current_stage="evaluation",
                models_discovered=len(discovered_models),
                updates_detected=updates_detected,
                source_results=source_counts,
            )

            evaluated_models = [self._evaluate_model(candidate) for candidate in discovered_models]
            release_candidates = sum(
                1 for candidate in evaluated_models if self._predict_release_confidence(candidate) >= 65.0
            )
            self._set_task_progress(
                task_id,
                current_stage="analysis",
                models_discovered=len(discovered_models),
                models_evaluated=len(evaluated_models),
                updates_detected=updates_detected,
                release_candidates=release_candidates,
                source_results=source_counts,
            )

            (
                persisted_count,
                notable_count,
                release_candidates,
                report_count,
                report_notifications,
            ) = self._persist_models_and_reports(
                task_id=task_id,
                evaluated_models=evaluated_models,
                min_score=min_score,
                execution_mode=execution_mode,
            )

            self._set_task_completed(
                task_id=task_id,
                summary_model_name=f"{persisted_count} models processed",
                progress={
                    "current_stage": "completed",
                    "execution_mode": execution_mode,
                    "models_discovered": len(discovered_models),
                    "models_evaluated": len(evaluated_models),
                    "updates_detected": updates_detected,
                    "release_candidates": release_candidates,
                    "notable_models": notable_count,
                    "reports_generated": report_count,
                    "source_results": source_counts,
                },
            )
            logger.info(
                "探索任务完成 task_id=%s discovered=%s evaluated=%s notable=%s reports=%s",
                task_id,
                len(discovered_models),
                len(evaluated_models),
                notable_count,
                report_count,
            )
            if report_notifications:
                notifier, platform = self._build_report_notifier()
                if notifier is None:
                    logger.info("模型先知报告已生成但通知渠道不可用，跳过发送 count=%s", len(report_notifications))
                else:
                    for payload in report_notifications:
                        self._notify_report_generated(
                            payload,
                            notifier=notifier,
                            platform=platform,
                        )
        except Exception as exc:  # noqa: BLE001
            logger.exception("探索任务失败 task_id=%s error=%s", task_id, exc)
            self._set_task_failed(task_id, str(exc))

    def get_runtime_config(self) -> Dict[str, Any]:
        """读取模型先知运行配置。"""
        with self.db.get_session() as session:
            monitor_sources_raw = AppSettingsRepository.get_setting(
                session, "exploration_monitor_sources", ",".join(DEFAULT_EXPLORATION_MONITOR_SOURCES)
            )
            watch_organizations_raw = AppSettingsRepository.get_setting(
                session, "exploration_watch_organizations", ",".join(DEFAULT_EXPLORATION_WATCH_ORGS)
            )
            min_score_raw = AppSettingsRepository.get_setting(session, "exploration_min_score", "70")
            days_back = AppSettingsRepository.get_setting(session, "exploration_days_back", 2)
            max_results_per_source = AppSettingsRepository.get_setting(
                session, "exploration_max_results_per_source", 30
            )
            run_mode_raw = AppSettingsRepository.get_setting(session, "exploration_run_mode", "auto")
            auto_monitor_enabled = AppSettingsRepository.get_setting(
                session, "auto_exploration_enabled", settings.AUTO_EXPLORATION_ENABLED
            )
            auto_monitor_interval_hours = AppSettingsRepository.get_setting(
                session, "auto_exploration_interval_hours", 24
            )

        monitor_sources = self._normalize_sources(monitor_sources_raw)
        watch_organizations = self._normalize_watch_orgs(watch_organizations_raw)

        try:
            min_score = float(min_score_raw)
        except (TypeError, ValueError):
            min_score = 70.0
        min_score = max(0.0, min(100.0, min_score))

        try:
            days_back_int = int(days_back)
        except (TypeError, ValueError):
            days_back_int = 2
        days_back_int = max(1, min(30, days_back_int))

        try:
            max_results_int = int(max_results_per_source)
        except (TypeError, ValueError):
            max_results_int = 30
        max_results_int = max(1, min(200, max_results_int))

        run_mode = str(run_mode_raw or "auto").strip().lower()
        if run_mode not in {"auto", "deterministic", "agent"}:
            run_mode = "auto"

        try:
            interval_hours = int(auto_monitor_interval_hours)
        except (TypeError, ValueError):
            interval_hours = 24
        interval_hours = max(1, min(168, interval_hours))

        return {
            "monitor_sources": monitor_sources,
            "watch_organizations": watch_organizations,
            "min_score": round(min_score, 2),
            "days_back": days_back_int,
            "max_results_per_source": max_results_int,
            "run_mode": run_mode,
            "auto_monitor_enabled": bool(auto_monitor_enabled),
            "auto_monitor_interval_hours": interval_hours,
        }

    def save_runtime_config(
        self,
        *,
        monitor_sources: List[str],
        watch_organizations: List[str],
        min_score: float,
        days_back: int,
        max_results_per_source: int,
        run_mode: str,
        auto_monitor_enabled: bool,
        auto_monitor_interval_hours: int,
    ) -> Dict[str, Any]:
        """保存模型先知运行配置。"""
        normalized_sources = self._normalize_sources(monitor_sources)
        normalized_watch_orgs = self._normalize_watch_orgs(watch_organizations)
        normalized_run_mode = str(run_mode or "auto").strip().lower()
        if normalized_run_mode not in {"auto", "deterministic", "agent"}:
            normalized_run_mode = "auto"

        min_score_value = max(0.0, min(100.0, float(min_score)))
        days_back_value = max(1, min(30, int(days_back)))
        max_results_value = max(1, min(200, int(max_results_per_source)))
        interval_value = max(1, min(168, int(auto_monitor_interval_hours)))

        with self.db.get_session() as session:
            AppSettingsRepository.set_setting(
                session,
                "exploration_monitor_sources",
                ",".join(normalized_sources),
                "string",
                "模型先知监控来源（逗号分隔）",
            )
            AppSettingsRepository.set_setting(
                session,
                "exploration_watch_organizations",
                ",".join(normalized_watch_orgs),
                "string",
                "模型先知监控组织（逗号分隔）",
            )
            AppSettingsRepository.set_setting(
                session,
                "exploration_min_score",
                f"{min_score_value:.2f}",
                "string",
                "模型先知最低综合评分阈值",
            )
            AppSettingsRepository.set_setting(
                session,
                "exploration_days_back",
                days_back_value,
                "int",
                "模型先知回溯天数",
            )
            AppSettingsRepository.set_setting(
                session,
                "exploration_max_results_per_source",
                max_results_value,
                "int",
                "模型先知每来源最大候选数",
            )
            AppSettingsRepository.set_setting(
                session,
                "exploration_run_mode",
                normalized_run_mode,
                "string",
                "模型先知执行模式",
            )
            AppSettingsRepository.set_setting(
                session,
                "auto_exploration_enabled",
                bool(auto_monitor_enabled),
                "bool",
                "是否启用模型先知自动监控",
            )
            AppSettingsRepository.set_setting(
                session,
                "auto_exploration_interval_hours",
                interval_value,
                "int",
                "模型先知自动监控间隔（小时）",
            )

        return self.get_runtime_config()

    def generate_report_for_model(
        self,
        model_id: int,
        run_mode: str = "auto",
        task_id: Optional[str] = None,
    ) -> ExplorationReport:
        """手动为指定模型生成报告。"""
        execution_mode = self._resolve_execution_mode(run_mode)
        report_agent = self._build_report_agent() if execution_mode == "agent" else None
        report: Optional[ExplorationReport] = None
        notification_payload: Optional[Dict[str, Any]] = None

        with self.db.get_session() as session:
            model = session.query(DiscoveredModel).filter(DiscoveredModel.id == model_id).first()
            if not model:
                raise ValueError("模型不存在")

            model_data = self._model_to_dict(model)
            report_payload: Optional[Dict[str, Any]] = None

            if report_agent:
                try:
                    report_payload = report_agent.generate_report(model_data)
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "手动生成报告时 Agent 失败，回退规则模式 model=%s error=%s",
                        model.model_name,
                        exc,
                    )

            if report_payload is None:
                analysis_payload = self._build_code_analysis_payload(model_data)
                report_payload = self._call_skill(
                    "report-generation",
                    "generate_report.py",
                    "generate_report",
                    model_data=model_data,
                    analysis_data=analysis_payload,
                )
            else:
                report_payload = self._hydrate_missing_analysis_sections(
                    report_payload=report_payload,
                    model_data=model_data,
                )

            effective_task_id = task_id or f"manual-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8]}"
            report = self._save_report(
                session=session,
                task_id=effective_task_id,
                model=model,
                payload=report_payload,
            )
            model.status = "reported"
            notification_payload = self._build_report_notification_payload(model=model, report=report)
            session.flush()
            session.refresh(report)
            session.expunge(report)

        if notification_payload:
            self._notify_report_generated(notification_payload)

        if report is None:
            raise RuntimeError("报告生成失败")
        return report

    def run_manual_report_task(self, task_id: str, model_id: int, run_mode: str = "auto") -> None:
        """后台执行手动报告生成任务。"""
        execution_mode = self._resolve_execution_mode(run_mode)
        self._set_manual_report_task_running(task_id=task_id, model_id=model_id, execution_mode=execution_mode)
        try:
            report = self.generate_report_for_model(model_id=model_id, run_mode=run_mode, task_id=task_id)
            with self.db.get_session() as session:
                model = session.query(DiscoveredModel).filter(DiscoveredModel.id == model_id).first()
                summary_model_name = model.model_name if model else f"model-{model_id}"

            self._set_task_completed(
                task_id=task_id,
                summary_model_name=summary_model_name,
                progress={
                    "current_stage": "completed",
                    "execution_mode": execution_mode,
                    "models_discovered": 0,
                    "models_evaluated": 1,
                    "updates_detected": 1,
                    "release_candidates": 1,
                    "notable_models": 0,
                    "reports_generated": 1,
                    "source_results": {},
                    "model_id": model_id,
                    "report_id": report.report_id,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("手动报告任务失败 task_id=%s model_id=%s error=%s", task_id, model_id, exc)
            self._set_task_failed(task_id, str(exc))

    def _discover_models(
        self,
        sources: List[str],
        days_back: int,
        max_results_per_source: int,
        keywords: Optional[List[str]],
        watch_organizations: Optional[List[str]],
    ) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
        if not sources:
            return [], {}

        search_keywords = keywords or ["LLM", "foundation model", "multimodal", "reasoning model"]
        source_counts: Dict[str, int] = {}
        collected: List[Dict[str, Any]] = []
        watch_list = watch_organizations or []

        for source in sources:
            records: List[Dict[str, Any]] = []
            try:
                if source == "github":
                    records = self._call_skill(
                        "model-discovery",
                        "discover_github.py",
                        "discover_github",
                        keywords=search_keywords,
                        days_back=days_back,
                        min_stars=100,
                        max_results=max_results_per_source,
                        watch_organizations=watch_list,
                    ) or []
                elif source == "huggingface":
                    records = self._call_skill(
                        "model-discovery",
                        "discover_huggingface.py",
                        "discover_huggingface",
                        keywords=search_keywords,
                        days_back=days_back,
                        max_results=max_results_per_source,
                        watch_organizations=watch_list,
                    ) or []
                elif source == "arxiv":
                    records = self._call_skill(
                        "model-discovery",
                        "discover_arxiv.py",
                        "discover_arxiv",
                        keywords=search_keywords,
                        days_back=days_back,
                        max_results=max_results_per_source,
                        watch_organizations=watch_list,
                    ) or []
                elif source == "modelscope":
                    records = self._call_skill(
                        "model-discovery",
                        "discover_modelscope.py",
                        "discover_modelscope",
                        keywords=search_keywords,
                        days_back=days_back,
                        max_results=max_results_per_source,
                        watch_organizations=watch_list,
                    ) or []
            except Exception as exc:  # noqa: BLE001
                logger.warning("数据源发现失败 source=%s error=%s", source, exc)

            normalized = [self._normalize_discovered_model(source, r) for r in records]
            normalized = [item for item in normalized if item.get("model_name")]
            source_counts[source] = len(normalized)
            collected.extend(normalized)

        return self._deduplicate_models(collected), source_counts

    def _normalize_discovered_model(self, source: str, raw: Dict[str, Any]) -> Dict[str, Any]:
        model_name = str(raw.get("model_name") or "").strip()
        organization = str(raw.get("organization") or "Unknown").strip() or "Unknown"
        description = str(raw.get("description") or "").strip()
        model_type = str(raw.get("model_type") or "Other").strip() or "Other"
        release_date = self._parse_datetime(raw.get("release_date"))
        raw_extra = raw.get("extra_data") if isinstance(raw.get("extra_data"), dict) else {}

        github_url = raw.get("github_url")
        paper_url = raw.get("paper_url")
        model_url = raw.get("model_url") or raw.get("url")

        if source == "github":
            github_url = github_url or raw.get("url")
        if source == "arxiv":
            paper_url = paper_url or raw.get("url")
        if source in {"huggingface", "modelscope"}:
            model_url = model_url or raw.get("url")

        updated_at = self._parse_datetime(
            raw.get("last_updated")
            or raw.get("updated_at")
            or raw.get("pushed_at")
            or raw_extra.get("updated_at")
        )
        update_type = (
            self._clean_str(raw.get("update_type"))
            or self._clean_str(raw_extra.get("update_type"))
            or "unknown"
        )
        signal_reasons = self._normalize_string_list(
            raw.get("signal_reasons") or raw_extra.get("signal_reasons")
        )
        release_confidence = self._to_float(
            raw.get("release_confidence")
            if raw.get("release_confidence") is not None
            else raw_extra.get("release_confidence"),
            default=self._predict_release_confidence({**raw, "extra_data": raw_extra}),
        )
        signal_score = self._to_float(
            raw.get("signal_score")
            if raw.get("signal_score") is not None
            else raw_extra.get("signal_score"),
            default=release_confidence,
        )

        source_uid = self._derive_source_uid(
            source=source,
            raw=raw,
            model_name=model_name,
            organization=organization,
            github_url=github_url,
            model_url=model_url,
            paper_url=paper_url,
        )

        return {
            "model_name": model_name,
            "model_type": model_type,
            "organization": organization,
            "release_date": release_date,
            "source_platform": source,
            "source_uid": source_uid,
            "github_url": self._clean_str(github_url),
            "paper_url": self._clean_str(paper_url),
            "model_url": self._clean_str(model_url),
            "license": self._clean_str(raw.get("license")) or "Unknown",
            "description": description,
            "github_stars": self._to_int(raw.get("github_stars"), default=0),
            "github_forks": self._to_int(raw.get("github_forks"), default=0),
            "paper_citations": self._to_int(raw.get("paper_citations"), default=0),
            "social_mentions": self._to_int(raw.get("social_mentions"), default=0),
            "extra_data": {
                "source_url": self._clean_str(raw.get("url")),
                "discovered_at": raw.get("discovered_at") or datetime.now().isoformat(),
                "updated_at": updated_at.isoformat() if updated_at else None,
                "update_type": update_type,
                "update_summary": self._clean_str(raw.get("update_summary") or raw_extra.get("update_summary")),
                "signal_reasons": signal_reasons,
                "signal_score": round(signal_score, 2),
                "release_confidence": round(release_confidence, 2),
                "watch_hit": bool(raw.get("watch_hit") or raw_extra.get("watch_hit")),
            },
        }

    def _evaluate_model(self, model_data: Dict[str, Any]) -> Dict[str, Any]:
        impact_score = self._call_skill(
            "model-evaluation",
            "calculate_impact.py",
            "calculate_impact_score",
            model_data=model_data,
        )
        quality_scores = self._call_skill(
            "model-evaluation",
            "evaluate_quality.py",
            "evaluate_quality_scores",
            model_data=model_data,
        )

        final_score = self._call_skill(
            "model-evaluation",
            "calculate_final_score.py",
            "calculate_final_score",
            impact_score=impact_score,
            quality_score=quality_scores["quality_score"],
            innovation_score=quality_scores["innovation_score"],
            practicality_score=quality_scores["practicality_score"],
        )

        evaluated = dict(model_data)
        evaluated["impact_score"] = round(float(impact_score), 2)
        evaluated["quality_score"] = round(float(quality_scores["quality_score"]), 2)
        evaluated["innovation_score"] = round(float(quality_scores["innovation_score"]), 2)
        evaluated["practicality_score"] = round(float(quality_scores["practicality_score"]), 2)
        evaluated["final_score"] = round(float(final_score), 2)
        return evaluated

    def _persist_models_and_reports(
        self,
        task_id: str,
        evaluated_models: List[Dict[str, Any]],
        min_score: float,
        execution_mode: str,
    ) -> Tuple[int, int, int, int, List[Dict[str, Any]]]:
        if not evaluated_models:
            return 0, 0, 0, 0, []

        report_agent = self._build_report_agent() if execution_mode == "agent" else None
        release_confidence_threshold = 65.0

        with self.db.get_session() as session:
            persisted_count = 0
            notable_count = 0
            release_candidate_count = 0
            report_count = 0
            report_notifications: List[Dict[str, Any]] = []

            for candidate in evaluated_models:
                predicted_release_confidence = self._predict_release_confidence(candidate)
                candidate_extra = candidate.get("extra_data") or {}
                if not isinstance(candidate_extra, dict):
                    candidate_extra = {}
                candidate_extra["release_confidence"] = predicted_release_confidence
                candidate["extra_data"] = candidate_extra
                is_release_candidate = predicted_release_confidence >= release_confidence_threshold
                if is_release_candidate:
                    release_candidate_count += 1

                model = self._upsert_model(session, candidate, min_score=min_score)
                persisted_count += 1

                should_create_report = (
                    model.is_notable
                    and is_release_candidate
                    and self._should_generate_report(session=session, model=model, candidate=candidate)
                )
                has_existing_report = self._has_existing_report(session=session, model_id=model.id)

                if model.is_notable:
                    notable_count += 1

                if should_create_report:
                    report_payload: Optional[Dict[str, Any]] = None
                    if report_agent:
                        try:
                            report_payload = report_agent.generate_report(self._model_to_dict(model))
                        except Exception as exc:  # noqa: BLE001
                            logger.warning(
                                "Agent 报告生成失败，回退规则模式 model=%s error=%s",
                                model.model_name,
                                exc,
                            )

                    if report_payload is None:
                        analysis_payload = self._build_code_analysis_payload(candidate)
                        report_payload = self._call_skill(
                            "report-generation",
                            "generate_report.py",
                            "generate_report",
                            model_data=self._model_to_dict(model),
                            analysis_data=analysis_payload,
                        )
                    else:
                        report_payload = self._hydrate_missing_analysis_sections(
                            report_payload=report_payload,
                            model_data=candidate,
                        )

                    report = self._save_report(session, task_id=task_id, model=model, payload=report_payload)
                    model.status = "reported"
                    report_count += 1
                    report_notifications.append(
                        self._build_report_notification_payload(model=model, report=report)
                    )
                else:
                    if has_existing_report:
                        model.status = "reported"
                    elif model.is_notable:
                        model.status = "watching"
                    else:
                        model.status = "evaluated"

            session.flush()
            return (
                persisted_count,
                notable_count,
                release_candidate_count,
                report_count,
                report_notifications,
            )

    def _upsert_model(
        self,
        session: Session,
        candidate: Dict[str, Any],
        min_score: float,
    ) -> DiscoveredModel:
        source_platform = str(candidate.get("source_platform") or "unknown").strip().lower() or "unknown"
        source_uid = str(candidate.get("source_uid") or "").strip().lower()
        if not source_uid:
            source_uid = self._derive_source_uid(
                source=source_platform,
                raw=candidate,
                model_name=str(candidate.get("model_name") or "").strip(),
                organization=str(candidate.get("organization") or "Unknown").strip() or "Unknown",
                github_url=candidate.get("github_url"),
                model_url=candidate.get("model_url"),
                paper_url=candidate.get("paper_url"),
            )

        existing = (
            session.query(DiscoveredModel)
            .filter(
                DiscoveredModel.source_platform == source_platform,
                DiscoveredModel.source_uid == source_uid,
            )
            .first()
        )

        # 兼容旧数据：source_uid 为空时，尝试按同源 model_name 匹配
        if existing is None:
            existing = (
                session.query(DiscoveredModel)
                .filter(
                    DiscoveredModel.source_platform == source_platform,
                    DiscoveredModel.model_name == candidate["model_name"],
                )
                .first()
            )

        if existing is None:
            model = DiscoveredModel(
                model_name=candidate["model_name"],
                model_type=candidate.get("model_type"),
                organization=candidate.get("organization"),
                release_date=candidate.get("release_date"),
                source_platform=source_platform,
                source_uid=source_uid,
                github_url=candidate.get("github_url"),
                paper_url=candidate.get("paper_url"),
                model_url=candidate.get("model_url"),
                license=candidate.get("license"),
                description=candidate.get("description"),
                github_stars=self._to_int(candidate.get("github_stars"), 0),
                github_forks=self._to_int(candidate.get("github_forks"), 0),
                paper_citations=self._to_int(candidate.get("paper_citations"), 0),
                social_mentions=self._to_int(candidate.get("social_mentions"), 0),
                impact_score=float(candidate.get("impact_score") or 0.0),
                quality_score=float(candidate.get("quality_score") or 0.0),
                innovation_score=float(candidate.get("innovation_score") or 0.0),
                practicality_score=float(candidate.get("practicality_score") or 0.0),
                final_score=float(candidate.get("final_score") or 0.0),
                status="evaluated",
                is_notable=float(candidate.get("final_score") or 0.0) >= min_score,
                extra_data=candidate.get("extra_data") or {},
            )
            session.add(model)
            session.flush()
            return model

        existing.model_type = candidate.get("model_type") or existing.model_type
        existing.organization = candidate.get("organization") or existing.organization
        existing.release_date = candidate.get("release_date") or existing.release_date
        existing.source_uid = source_uid or existing.source_uid
        existing.github_url = candidate.get("github_url") or existing.github_url
        existing.paper_url = candidate.get("paper_url") or existing.paper_url
        existing.model_url = candidate.get("model_url") or existing.model_url
        existing.license = candidate.get("license") or existing.license
        existing.description = (
            candidate.get("description")
            if len(candidate.get("description") or "") > len(existing.description or "")
            else existing.description
        )
        existing.github_stars = max(existing.github_stars or 0, self._to_int(candidate.get("github_stars"), 0))
        existing.github_forks = max(existing.github_forks or 0, self._to_int(candidate.get("github_forks"), 0))
        existing.paper_citations = max(
            existing.paper_citations or 0,
            self._to_int(candidate.get("paper_citations"), 0),
        )
        existing.social_mentions = max(
            existing.social_mentions or 0,
            self._to_int(candidate.get("social_mentions"), 0),
        )
        existing.impact_score = float(candidate.get("impact_score") or existing.impact_score or 0.0)
        existing.quality_score = float(candidate.get("quality_score") or existing.quality_score or 0.0)
        existing.innovation_score = float(candidate.get("innovation_score") or existing.innovation_score or 0.0)
        existing.practicality_score = float(candidate.get("practicality_score") or existing.practicality_score or 0.0)
        existing.final_score = float(candidate.get("final_score") or existing.final_score or 0.0)
        existing.is_notable = (existing.final_score or 0.0) >= min_score

        extra_data = existing.extra_data or {}
        candidate_extra = candidate.get("extra_data") or {}
        if isinstance(candidate_extra, dict):
            for key, value in candidate_extra.items():
                if value is None:
                    continue
                extra_data[key] = value
        existing.extra_data = extra_data
        session.flush()
        return existing

    def _build_code_analysis_payload(self, model_data: Dict[str, Any]) -> Dict[str, Any]:
        structure = self._call_skill(
            "code-analysis",
            "analyze_structure.py",
            "analyze_structure",
            model_data=model_data,
        )
        architecture = self._call_skill(
            "code-analysis",
            "analyze_model.py",
            "analyze_model_architecture",
            model_data=model_data,
        )
        benchmarks = self._call_skill(
            "code-analysis",
            "extract_benchmarks.py",
            "extract_benchmarks",
            model_data=model_data,
        )
        return {
            "structure": structure,
            "architecture": architecture,
            "benchmarks": benchmarks,
        }

    def _should_generate_report(
        self,
        session: Session,
        model: DiscoveredModel,
        candidate: Dict[str, Any],
    ) -> bool:
        latest_report = (
            session.query(ExplorationReport)
            .filter(ExplorationReport.model_id == model.id)
            .order_by(ExplorationReport.generated_at.desc())
            .first()
        )
        if latest_report is None:
            return True

        updated_at = self._parse_datetime((candidate.get("extra_data") or {}).get("updated_at"))
        if updated_at is None:
            return False
        return updated_at > latest_report.generated_at

    @staticmethod
    def _has_existing_report(session: Session, model_id: int) -> bool:
        report = (
            session.query(ExplorationReport.id)
            .filter(ExplorationReport.model_id == model_id)
            .first()
        )
        return report is not None

    def _save_report(
        self,
        session: Session,
        task_id: str,
        model: DiscoveredModel,
        payload: Dict[str, Any],
    ) -> ExplorationReport:
        generated_at = datetime.now()
        raw_title = str(payload.get("title") or "").strip()
        if not raw_title or raw_title in {"模型详细分析报告", "模型分析报告", "Detailed Report"}:
            title = f"{model.model_name} 偷跑分析报告"
        else:
            title = raw_title
        summary = self._normalize_summary(str(payload.get("summary") or ""), model=model)
        highlights = [
            item
            for item in (normalize_bullet_item(raw) for raw in (payload.get("highlights") or []))
            if item
        ]
        if not highlights:
            highlights = self._default_highlights(model=model)

        use_cases = self._normalize_string_list(payload.get("use_cases"))
        if not use_cases:
            use_cases = self._default_use_cases(model_type=model.model_type)

        risks = self._normalize_string_list(payload.get("risks"))
        if not risks:
            risks = self._default_risks(model_type=model.model_type)

        recommendations = self._normalize_string_list(payload.get("recommendations"))
        if not recommendations:
            recommendations = self._default_recommendations()

        references = self._normalize_references(payload.get("references"))
        if not references:
            references = self._default_references(model=model)

        technical_analysis = to_markdown_text(payload.get("technical_analysis"))
        if not technical_analysis.strip():
            technical_analysis = (
                "- 证据状态：当前缺少可验证的技术实现细节。\n"
                "- 推断结论：模型可能基于 Transformer 路线，但缺少结构级证据。\n"
                "- 建议：补充仓库关键模块与论文方法章节证据后再复审。"
            )

        performance_analysis = to_markdown_text(payload.get("performance_analysis"))
        if not performance_analysis.strip():
            performance_analysis = (
                "- 证据状态：未获取可复现的 benchmark 配置与完整指标。\n"
                "- 推断结论：当前性能主张不可独立验证。\n"
                "- 建议：补充任务、指标、基线、硬件与推理配置后再评估。"
            )

        code_analysis = to_markdown_text(payload.get("code_analysis"))
        if not code_analysis.strip():
            code_analysis = (
                "- 证据状态：未获取可确认的仓库结构与工程化信息。\n"
                "- 推断结论：代码质量与可维护性暂无法评估。\n"
                "- 建议：补充目录结构、依赖、测试与示例后再判定。"
            )
        report_data = {
            "title": title,
            "summary": summary,
            "highlights": highlights,
            "technical_analysis": technical_analysis,
            "performance_analysis": performance_analysis,
            "code_analysis": code_analysis,
            "use_cases": use_cases,
            "risks": risks,
            "recommendations": recommendations,
            "references": references,
            "model_used": payload.get("model_used") or "rule-based-evaluator",
        }
        full_report = render_professional_report(
            model_data=self._model_to_dict(model),
            report_data=report_data,
            generated_at=generated_at,
            report_version="1.0",
        )

        report = ExplorationReport(
            report_id=f"report-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8]}",
            task_id=task_id,
            model_id=model.id,
            title=title,
            summary=summary,
            highlights=highlights,
            technical_analysis=technical_analysis,
            performance_analysis=performance_analysis,
            code_analysis=code_analysis,
            use_cases=use_cases,
            risks=risks,
            recommendations=recommendations,
            references=references,
            full_report=full_report,
            report_version="1.0",
            agent_version="1.0",
            model_used=payload.get("model_used") or "rule-based-evaluator",
            generation_time=float(payload.get("generation_time") or 0.0),
            generated_at=generated_at,
        )
        session.add(report)
        session.flush()
        return report

    @staticmethod
    def _build_report_notification_payload(
        model: DiscoveredModel,
        report: ExplorationReport,
    ) -> Dict[str, Any]:
        extra_data = model.extra_data if isinstance(model.extra_data, dict) else {}
        return {
            "report_id": report.report_id,
            "model_id": model.id,
            "model_name": model.model_name,
            "source_platform": model.source_platform,
            "final_score": model.final_score,
            "release_confidence": extra_data.get("release_confidence"),
            "summary": report.summary,
        }

    @staticmethod
    def _build_report_notifier() -> Tuple[Optional[NotificationService], Optional[str]]:
        settings.load_settings_from_db()
        webhook_url = str(settings.NOTIFICATION_WEBHOOK_URL or "").strip()
        platform = str(settings.NOTIFICATION_PLATFORM or "feishu").strip().lower()
        secret = str(settings.NOTIFICATION_SECRET or "").strip()

        if not webhook_url:
            return None, platform
        if platform not in {"feishu", "dingtalk"}:
            return None, platform

        notifier = NotificationService(
            platform=platform,
            webhook_url=webhook_url,
            secret=secret,
        )
        return notifier, platform

    def _notify_report_generated(
        self,
        report_data: Dict[str, Any],
        notifier: Optional[NotificationService] = None,
        platform: Optional[str] = None,
    ) -> bool:
        try:
            report_id = str(report_data.get("report_id") or "")
            model_name = str(report_data.get("model_name") or "")

            if notifier is None:
                notifier, platform = self._build_report_notifier()
                if notifier is None:
                    if not str(settings.NOTIFICATION_WEBHOOK_URL or "").strip():
                        logger.info(
                            "模型先知报告已生成但未配置通知 webhook，跳过发送 report_id=%s model=%s",
                            report_id,
                            model_name,
                        )
                    else:
                        logger.warning(
                            "模型先知报告通知平台不受支持，跳过发送 platform=%s report_id=%s",
                            settings.NOTIFICATION_PLATFORM,
                            report_id,
                        )
                    return False

            effective_platform = platform or notifier.platform
            success = notifier.send_exploration_report_alert(report_data=report_data, db=self.db)
            if success:
                logger.info(
                    "模型先知报告通知发送成功 report_id=%s model=%s platform=%s",
                    report_id,
                    model_name,
                    effective_platform,
                )
            else:
                logger.warning(
                    "模型先知报告通知发送失败 report_id=%s model=%s platform=%s",
                    report_id,
                    model_name,
                    effective_platform,
                )
            return success
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "发送模型先知报告通知异常 report_id=%s error=%s",
                report_data.get("report_id"),
                exc,
            )
            return False

    def _set_task_running(self, task_id: str, sources: List[str], execution_mode: str) -> None:
        with self.db.get_session() as session:
            task = session.query(ExplorationTask).filter(ExplorationTask.task_id == task_id).first()
            if not task:
                return
            task.status = "running"
            task.start_time = datetime.now()
            task.source = ",".join(sources)
            task.progress = {
                "current_stage": "discovery",
                "execution_mode": execution_mode,
                "models_discovered": 0,
                "models_evaluated": 0,
                "updates_detected": 0,
                "release_candidates": 0,
                "notable_models": 0,
                "reports_generated": 0,
                "source_results": {},
            }
            task.error_message = None

    def _set_manual_report_task_running(self, task_id: str, model_id: int, execution_mode: str) -> None:
        with self.db.get_session() as session:
            task = session.query(ExplorationTask).filter(ExplorationTask.task_id == task_id).first()
            if not task:
                return
            task.status = "running"
            task.start_time = datetime.now()
            task.source = "manual-report"
            progress: Dict[str, Any] = task.progress or {}
            progress.update(
                {
                    "current_stage": "report_generation",
                    "execution_mode": execution_mode,
                    "models_discovered": 0,
                    "models_evaluated": 1,
                    "updates_detected": 1,
                    "release_candidates": 1,
                    "notable_models": 0,
                    "reports_generated": 0,
                    "source_results": {},
                    "model_id": model_id,
                }
            )
            task.progress = progress
            task.error_message = None

    def _set_task_progress(
        self,
        task_id: str,
        current_stage: str,
        models_discovered: Optional[int] = None,
        models_evaluated: Optional[int] = None,
        updates_detected: Optional[int] = None,
        release_candidates: Optional[int] = None,
        notable_models: Optional[int] = None,
        reports_generated: Optional[int] = None,
        source_results: Optional[Dict[str, int]] = None,
    ) -> None:
        with self.db.get_session() as session:
            task = session.query(ExplorationTask).filter(ExplorationTask.task_id == task_id).first()
            if not task:
                return

            progress: Dict[str, Any] = task.progress or {}
            progress["current_stage"] = current_stage
            if models_discovered is not None:
                progress["models_discovered"] = models_discovered
            if models_evaluated is not None:
                progress["models_evaluated"] = models_evaluated
            if updates_detected is not None:
                progress["updates_detected"] = updates_detected
            if release_candidates is not None:
                progress["release_candidates"] = release_candidates
            if notable_models is not None:
                progress["notable_models"] = notable_models
            if reports_generated is not None:
                progress["reports_generated"] = reports_generated
            if source_results is not None:
                progress["source_results"] = source_results

            task.progress = progress

    def _set_task_completed(self, task_id: str, summary_model_name: str, progress: Dict[str, Any]) -> None:
        with self.db.get_session() as session:
            task = session.query(ExplorationTask).filter(ExplorationTask.task_id == task_id).first()
            if not task:
                return
            task.status = "completed"
            task.model_name = summary_model_name
            task.end_time = datetime.now()
            task.progress = progress
            task.error_message = None

    def _set_task_failed(self, task_id: str, error_message: str) -> None:
        with self.db.get_session() as session:
            task = session.query(ExplorationTask).filter(ExplorationTask.task_id == task_id).first()
            if not task:
                return
            task.status = "failed"
            task.end_time = datetime.now()
            task.error_message = error_message[:2000]
            progress: Dict[str, Any] = task.progress or {}
            progress["current_stage"] = "failed"
            task.progress = progress

    def _resolve_execution_mode(self, run_mode: str) -> str:
        requested = (run_mode or "auto").strip().lower()
        settings.load_llm_settings()

        configured = (settings.EXPLORATION_EXECUTION_MODE or "auto").strip().lower()
        candidate = requested if requested in {"agent", "deterministic", "auto"} else configured

        if candidate == "auto":
            candidate = "agent" if self._can_use_agent_mode() else "deterministic"

        if candidate == "agent" and not self._can_use_agent_mode():
            logger.warning("探索任务请求 agent 模式，但未找到可用模型配置，自动回退为 deterministic。")
            return "deterministic"
        if candidate not in {"agent", "deterministic"}:
            return "deterministic"
        return candidate

    @staticmethod
    def _can_use_agent_mode() -> bool:
        provider = settings.get_exploration_provider_config()
        if not provider:
            return False
        if not provider.get("api_key"):
            return False

        selected_model = str(provider.get("selected_model") or "").strip()
        if selected_model:
            return True
        llm_models = provider.get("llm_models") or []
        return bool(llm_models) or bool(str(provider.get("llm_model") or "").strip())

    def _build_report_agent(self) -> Optional[ExplorationReportAgent]:
        provider = settings.get_exploration_provider_config()
        if not provider:
            return None
        if not provider.get("api_key"):
            return None
        try:
            return ExplorationReportAgent(provider_config=provider, call_skill=self._call_skill)
        except Exception as exc:  # noqa: BLE001
            logger.warning("初始化探索 Agent 失败，回退规则模式 error=%s", exc)
            return None

    def _hydrate_missing_analysis_sections(
        self,
        report_payload: Dict[str, Any],
        model_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        need_analysis = any(
            not str(report_payload.get(key) or "").strip()
            for key in ["technical_analysis", "performance_analysis", "code_analysis"]
        )
        if not need_analysis:
            return report_payload

        analysis_payload = self._build_code_analysis_payload(model_data)
        if not str(report_payload.get("technical_analysis") or "").strip():
            report_payload["technical_analysis"] = to_markdown_text(
                analysis_payload.get("architecture") or ""
            )
        if not str(report_payload.get("performance_analysis") or "").strip():
            report_payload["performance_analysis"] = to_markdown_text(
                analysis_payload.get("benchmarks") or ""
            )
        if not str(report_payload.get("code_analysis") or "").strip():
            report_payload["code_analysis"] = to_markdown_text(
                analysis_payload.get("structure") or ""
            )
        return report_payload

    def _call_skill(
        self,
        skill_name: str,
        script_name: str,
        function_name: str,
        **kwargs: Any,
    ) -> Any:
        callable_fn = self._load_skill_callable(skill_name, script_name, function_name)
        return callable_fn(**kwargs)

    def _load_skill_callable(
        self,
        skill_name: str,
        script_name: str,
        function_name: str,
    ) -> Callable[..., Any]:
        cache_key = f"{skill_name}/{script_name}:{function_name}"
        if cache_key in self._callable_cache:
            return self._callable_cache[cache_key]

        script_path = self.skills_root / skill_name / "scripts" / script_name
        if not script_path.exists():
            raise FileNotFoundError(f"Skill 脚本不存在: {script_path}")

        spec = importlib.util.spec_from_file_location(
            f"skill_{skill_name.replace('-', '_')}_{script_name.replace('.', '_')}",
            str(script_path),
        )
        if not spec or not spec.loader:
            raise RuntimeError(f"无法加载 Skill 脚本: {script_path}")

        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # type: ignore[assignment]

        callable_fn = getattr(module, function_name, None)
        if not callable(callable_fn):
            raise AttributeError(f"Skill 函数不存在: {function_name} ({script_path})")

        self._callable_cache[cache_key] = callable_fn
        return callable_fn

    @staticmethod
    def _deduplicate_models(models: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        deduped: Dict[str, Dict[str, Any]] = {}
        for model in models:
            source_platform = str(model.get("source_platform") or "unknown").strip().lower()
            source_uid = str(model.get("source_uid") or "").strip().lower()
            if not source_uid:
                source_uid = (model.get("model_name") or "").strip().lower()
            if not source_uid:
                continue
            key = f"{source_platform}:{source_uid}"
            if key not in deduped:
                deduped[key] = model
                continue

            existing = deduped[key]
            if (model.get("github_stars") or 0) > (existing.get("github_stars") or 0):
                deduped[key] = model
                continue

            # 保留更完整信息
            for field in ["github_url", "paper_url", "model_url", "license", "description", "organization"]:
                if not existing.get(field) and model.get(field):
                    existing[field] = model[field]
            existing["github_forks"] = max(existing.get("github_forks") or 0, model.get("github_forks") or 0)
            existing["paper_citations"] = max(
                existing.get("paper_citations") or 0,
                model.get("paper_citations") or 0,
            )
            existing["social_mentions"] = max(
                existing.get("social_mentions") or 0,
                model.get("social_mentions") or 0,
            )
        return list(deduped.values())

    @staticmethod
    def _to_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _to_float(value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _predict_release_confidence(self, candidate: Dict[str, Any]) -> float:
        extra_data = candidate.get("extra_data") if isinstance(candidate.get("extra_data"), dict) else {}
        explicit_confidence = candidate.get("release_confidence")
        if explicit_confidence is None:
            explicit_confidence = extra_data.get("release_confidence")

        base = self._to_float(explicit_confidence, default=-1.0)
        if base < 0:
            update_type = (
                self._clean_str(candidate.get("update_type"))
                or self._clean_str(extra_data.get("update_type"))
                or "unknown"
            ).lower()
            type_base_map = {
                "new_model_repo": 78.0,
                "new_model_card": 75.0,
                "new_release_tag": 84.0,
                "weights_update": 72.0,
                "major_commit": 68.0,
                "paper_code_release": 74.0,
                "new_research_signal": 62.0,
                "unknown": 55.0,
            }
            base = type_base_map.get(update_type, 58.0)

        stars = self._to_int(candidate.get("github_stars"), default=0)
        forks = self._to_int(candidate.get("github_forks"), default=0)
        paper_citations = self._to_int(candidate.get("paper_citations"), default=0)
        signal_score = self._to_float(extra_data.get("signal_score"), default=0.0)

        bonus = 0.0
        if stars >= 2000:
            bonus += 8.0
        elif stars >= 500:
            bonus += 5.0
        elif stars >= 100:
            bonus += 2.5

        if forks >= 200:
            bonus += 3.0
        if paper_citations >= 50:
            bonus += 2.0
        if extra_data.get("watch_hit"):
            bonus += 5.0
        if self._clean_str(candidate.get("paper_url")):
            bonus += 1.5
        if signal_score > 0:
            bonus += min(6.0, signal_score * 0.08)

        summary_text = str(extra_data.get("update_summary") or "").lower()
        if any(token in summary_text for token in ["release", "checkpoint", "权重", "tag"]):
            bonus += 2.0

        return round(max(0.0, min(99.0, base + bonus)), 2)

    @staticmethod
    def _normalize_string_list(value: Any) -> List[str]:
        if isinstance(value, list):
            items = [normalize_bullet_item(raw) for raw in value]
            return [item for item in items if item]
        if isinstance(value, str):
            item = normalize_bullet_item(value)
            return [item] if item else []
        return []

    @staticmethod
    def _normalize_sources(value: Any) -> List[str]:
        if isinstance(value, str):
            raw_items = [item.strip().lower() for item in value.split(",")]
        elif isinstance(value, list):
            raw_items = [str(item).strip().lower() for item in value]
        else:
            raw_items = []

        deduped: List[str] = []
        for item in raw_items:
            if not item or item not in ALLOWED_EXPLORATION_SOURCES:
                continue
            if item not in deduped:
                deduped.append(item)
        return deduped or list(DEFAULT_EXPLORATION_MONITOR_SOURCES)

    @staticmethod
    def _normalize_watch_orgs(value: Any) -> List[str]:
        if isinstance(value, str):
            raw_items = [item.strip().lower() for item in value.split(",")]
        elif isinstance(value, list):
            raw_items = [str(item).strip().lower() for item in value]
        else:
            raw_items = []

        deduped: List[str] = []
        for item in raw_items:
            if not item:
                continue
            if item not in deduped:
                deduped.append(item)
        return deduped[:50] or list(DEFAULT_EXPLORATION_WATCH_ORGS)

    @staticmethod
    def _normalize_references(value: Any) -> Dict[str, str]:
        if not isinstance(value, dict):
            return {}
        normalized: Dict[str, str] = {}
        for key, raw in value.items():
            label = str(key).strip()
            text = str(raw).strip() if raw is not None else ""
            if not label or not text:
                continue
            normalized[label] = text
        return normalized

    @staticmethod
    def _normalize_summary(summary: str, model: DiscoveredModel) -> str:
        text = (summary or "").strip()
        invalid_tokens = {"", "{", "}", "[", "]", "null", "none"}
        if text.lower() in invalid_tokens or len(text) < 16:
            extra_data = model.extra_data if isinstance(model.extra_data, dict) else {}
            release_confidence = extra_data.get("release_confidence")
            try:
                confidence_text = f"{float(release_confidence):.1f}/100"
            except (TypeError, ValueError):
                confidence_text = "N/A"
            update_type = str(extra_data.get("update_type") or "unknown")
            return (
                f"{model.model_name} 由 {model.organization or 'Unknown'} 发布，来源平台为 "
                f"{model.source_platform or 'unknown'}。当前发布置信度 {confidence_text}，"
                f"信号类型 {update_type}，综合评分 {float(model.final_score or 0.0):.1f}/100。"
                "基于现有公开信息完成初步偷跑研判，建议结合仓库与论文证据继续验证。"
            )
        return text

    @staticmethod
    def _default_highlights(model: DiscoveredModel) -> List[str]:
        highlights = [
            f"综合评分 {float(model.final_score or 0.0):.1f}/100",
            f"影响/质量/创新/实用评分：{float(model.impact_score or 0.0):.1f}/"
            f"{float(model.quality_score or 0.0):.1f}/"
            f"{float(model.innovation_score or 0.0):.1f}/"
            f"{float(model.practicality_score or 0.0):.1f}",
            f"社区指标：stars={int(model.github_stars or 0)}, forks={int(model.github_forks or 0)}",
        ]
        extra_data = model.extra_data if isinstance(model.extra_data, dict) else {}
        release_confidence = extra_data.get("release_confidence")
        try:
            confidence_text = f"{float(release_confidence):.1f}"
        except (TypeError, ValueError):
            confidence_text = ""
        if confidence_text:
            highlights.append(f"发布置信度：{confidence_text}/100")
        return highlights

    @staticmethod
    def _default_use_cases(model_type: Optional[str]) -> List[str]:
        normalized = str(model_type or "").strip().lower()
        mapping = {
            "llm": ["知识问答", "内容生成", "代码辅助"],
            "vision": ["图像理解", "检测分类", "视觉自动化"],
            "audio": ["语音识别", "语音生成", "音频理解"],
            "multimodal": ["图文问答", "多模态检索", "跨模态生成"],
            "generative": ["内容生成", "创意辅助", "数据增强"],
        }
        return mapping.get(normalized, ["通用研究评估", "原型验证", "业务适配测试"])

    @staticmethod
    def _default_risks(model_type: Optional[str]) -> List[str]:
        risks = [
            "公开证据有限，关键实现细节可能与外部描述不一致",
            "缺少统一 benchmark 配置，跨模型横向比较存在偏差",
        ]
        if str(model_type or "").strip().lower() == "llm":
            risks.append("推理成本与延迟在大规模部署场景下可能偏高")
        return risks

    @staticmethod
    def _default_recommendations() -> List[str]:
        return [
            "优先复核仓库与论文中的实验设置、评测脚本和数据范围",
            "先做小规模离线验证，再决定是否进入线上试点",
            "持续跟踪社区 issue、版本更新和复现反馈",
        ]

    @staticmethod
    def _default_references(model: DiscoveredModel) -> Dict[str, str]:
        refs: Dict[str, str] = {}
        if model.github_url:
            refs["github"] = model.github_url
        if model.paper_url:
            refs["paper"] = model.paper_url
        if model.model_url:
            refs["model"] = model.model_url
        return refs

    @staticmethod
    def _clean_str(value: Any) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    @staticmethod
    def _parse_datetime(value: Any) -> Optional[datetime]:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            try:
                return datetime.fromisoformat(text).replace(tzinfo=None)
            except ValueError:
                return None
        return None

    @classmethod
    def _derive_source_uid(
        cls,
        source: str,
        raw: Dict[str, Any],
        model_name: str,
        organization: str,
        github_url: Any,
        model_url: Any,
        paper_url: Any,
    ) -> str:
        explicit_uid = cls._clean_str(
            raw.get("source_uid")
            or raw.get("source_id")
            or raw.get("full_name")
            or raw.get("model_id")
            or raw.get("modelId")
        )
        if explicit_uid:
            return explicit_uid.lower()

        source_key = (source or "").strip().lower()
        if source_key == "github":
            parsed_repo = cls._extract_repo_from_url(github_url or raw.get("url"), host="github.com")
            if parsed_repo:
                return parsed_repo.lower()
        elif source_key == "huggingface":
            parsed_model = cls._extract_repo_from_url(model_url or raw.get("url"), host="huggingface.co")
            if parsed_model:
                return parsed_model.lower()
        elif source_key == "modelscope":
            parsed_model = cls._extract_repo_from_url(model_url or raw.get("url"), host="modelscope.cn")
            if parsed_model:
                return parsed_model.lower()
        elif source_key == "arxiv":
            parsed_arxiv = cls._extract_arxiv_id(paper_url or raw.get("url"))
            if parsed_arxiv:
                return parsed_arxiv.lower()

        # 兜底：同平台内组织+模型名
        normalized_org = (organization or "unknown-org").strip().lower().replace(" ", "-")
        normalized_name = (model_name or "unknown-model").strip().lower().replace(" ", "-")
        return f"{normalized_org}/{normalized_name}"

    @staticmethod
    def _extract_repo_from_url(url: Any, host: str) -> Optional[str]:
        if not url:
            return None
        try:
            parsed = urlparse(str(url).strip())
            if host not in (parsed.netloc or "").lower():
                return None
            path_parts = [part for part in (parsed.path or "").split("/") if part]
            if len(path_parts) < 2:
                return None
            repo = f"{path_parts[0]}/{path_parts[1]}"
            if repo.endswith(".git"):
                repo = repo[:-4]
            return repo or None
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def _extract_arxiv_id(url: Any) -> Optional[str]:
        if not url:
            return None
        text = str(url).strip()
        if not text:
            return None
        match = re.search(r"arxiv\.org/(?:abs|pdf)/([0-9]+\.[0-9]+)(?:v[0-9]+)?", text)
        if match:
            return match.group(1)
        # 兼容直接传 paper id
        match = re.search(r"^([0-9]+\.[0-9]+)(?:v[0-9]+)?$", text)
        if match:
            return match.group(1)
        return None

    @staticmethod
    def _model_to_dict(model: DiscoveredModel) -> Dict[str, Any]:
        return {
            "id": model.id,
            "model_name": model.model_name,
            "model_type": model.model_type,
            "organization": model.organization,
            "release_date": model.release_date.isoformat() if model.release_date else None,
            "source_platform": model.source_platform,
            "source_uid": model.source_uid,
            "github_url": model.github_url,
            "paper_url": model.paper_url,
            "model_url": model.model_url,
            "license": model.license,
            "description": model.description,
            "github_stars": model.github_stars,
            "github_forks": model.github_forks,
            "paper_citations": model.paper_citations,
            "social_mentions": model.social_mentions,
            "impact_score": model.impact_score,
            "quality_score": model.quality_score,
            "innovation_score": model.innovation_score,
            "practicality_score": model.practicality_score,
            "final_score": model.final_score,
            "status": model.status,
            "is_notable": model.is_notable,
            "extra_data": model.extra_data or {},
        }


_exploration_service: Optional[ExplorationService] = None


def get_exploration_service() -> ExplorationService:
    global _exploration_service
    if _exploration_service is None:
        _exploration_service = ExplorationService()
    return _exploration_service
