"""
自主探索 API 端点
"""
import atexit
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime
import logging
import threading
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import Float, cast, func
from sqlalchemy.orm import Session

from backend.app.api.v1.endpoints.settings import require_auth
from backend.app.core.dependencies import get_database
from backend.app.db.models import DiscoveredModel, ExplorationReport, ExplorationTask
from backend.app.schemas.exploration import (
    ExplorationConfigResponse,
    ExplorationConfigUpdate,
    DiscoveredModelListResponse,
    DiscoveredModelResponse,
    ExplorationModelDetailResponse,
    ExplorationGenerateReportResponse,
    ExplorationModelMarkRequest,
    ExplorationModelSortBy,
    ExplorationOrderBy,
    ExplorationReportListResponse,
    ExplorationReportResponse,
    ExplorationReportSummaryResponse,
    ExplorationStatisticsResponse,
    ExplorationTaskCreate,
    ExplorationTaskListResponse,
    ExplorationTaskResponse,
    ExplorationTaskStartResponse,
)
from backend.app.services.exploration import get_exploration_service
from backend.app.services.exploration.markdown_formatter import (
    looks_like_markdown,
    normalize_bullet_item,
    to_markdown_text,
)

router = APIRouter()
logger = logging.getLogger(__name__)

ACTIVE_TASK_STATUSES = ("pending", "running")
_EXPLORATION_START_LOCK = threading.Lock()
_MANUAL_REPORT_LOCK = threading.Lock()
_BACKGROUND_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="exploration-worker")


@atexit.register
def _shutdown_background_executor() -> None:
    _BACKGROUND_EXECUTOR.shutdown(wait=False, cancel_futures=False)


def _on_background_task_done(task_id: str, future: Future) -> None:
    try:
        future.result()
    except Exception as exc:  # noqa: BLE001
        logger.exception("后台任务异常 task_id=%s error=%s", task_id, exc)


def _submit_background_task(task_id: str, fn, *args) -> None:
    future = _BACKGROUND_EXECUTOR.submit(fn, *args)
    future.add_done_callback(lambda task_future: _on_background_task_done(task_id, task_future))


def _cleanup_stale_active_tasks(db: Session) -> int:
    """
    清理异常中断后遗留的 pending/running 任务，避免前端一直被“进行中”阻塞。
    """
    now = datetime.now()
    stale_count = 0
    active_tasks = (
        db.query(ExplorationTask)
        .filter(ExplorationTask.status.in_(ACTIVE_TASK_STATUSES))
        .all()
    )
    for task in active_tasks:
        reference_time = task.start_time or task.created_at or task.discovery_time
        if not reference_time:
            continue
        elapsed_seconds = (now - reference_time).total_seconds()
        timeout_seconds = 6 * 3600 if task.status == "running" else 30 * 60
        if elapsed_seconds < timeout_seconds:
            continue
        task.status = "failed"
        task.end_time = now
        task.error_message = "任务长时间未完成，已自动标记为失败（可能服务重启导致中断）"
        stale_count += 1

    if stale_count > 0:
        db.commit()
        logger.warning("自动清理过期探索任务 count=%s", stale_count)
    return stale_count


def _find_active_exploration_task(db: Session) -> Optional[ExplorationTask]:
    return (
        db.query(ExplorationTask)
        .filter(
            ExplorationTask.status.in_(ACTIVE_TASK_STATUSES),
            ExplorationTask.source != "manual-report",
        )
        .order_by(ExplorationTask.created_at.desc())
        .first()
    )


def _find_active_manual_report_task(db: Session, model_id: int) -> Optional[ExplorationTask]:
    active_manual_tasks = (
        db.query(ExplorationTask)
        .filter(
            ExplorationTask.status.in_(ACTIVE_TASK_STATUSES),
            ExplorationTask.source == "manual-report",
        )
        .order_by(ExplorationTask.created_at.desc())
        .all()
    )
    for task in active_manual_tasks:
        progress = task.progress if isinstance(task.progress, dict) else {}
        try:
            if int(progress.get("model_id")) == model_id:
                return task
        except (TypeError, ValueError):
            continue
    return None


@router.get("/config", response_model=ExplorationConfigResponse)
async def get_exploration_config() -> ExplorationConfigResponse:
    """
    获取模型先知配置
    """
    service = get_exploration_service()
    payload = service.get_runtime_config()
    return ExplorationConfigResponse(**payload)


@router.put("/config", response_model=ExplorationConfigResponse)
async def update_exploration_config(
    request: ExplorationConfigUpdate,
    current_user: str = Depends(require_auth),
) -> ExplorationConfigResponse:
    """
    更新模型先知配置
    """
    del current_user
    service = get_exploration_service()
    payload = service.save_runtime_config(
        monitor_sources=request.monitor_sources,
        watch_organizations=request.watch_organizations,
        min_score=request.min_score,
        days_back=request.days_back,
        max_results_per_source=request.max_results_per_source,
        run_mode=request.run_mode,
        auto_monitor_enabled=request.auto_monitor_enabled,
        auto_monitor_interval_hours=request.auto_monitor_interval_hours,
    )

    try:
        from backend.app.main import scheduler
        if scheduler:
            if payload["auto_monitor_enabled"]:
                scheduler.add_exploration_job()
            else:
                job = scheduler.scheduler.get_job("exploration_job")
                if job:
                    scheduler.scheduler.remove_job("exploration_job")
    except Exception as exc:  # noqa: BLE001
        logger.warning("更新模型先知调度任务失败 error=%s", exc)

    return ExplorationConfigResponse(**payload)


def _render_summary_markdown(report: ExplorationReportResponse) -> str:
    highlights = [item for item in (normalize_bullet_item(raw) for raw in (report.highlights or [])) if item]
    lines = [report.summary or "暂无摘要", "", "## 核心亮点"]
    if highlights:
        lines.extend([f"- {item}" for item in highlights])
    else:
        lines.append("- 暂无")
    return "\n".join(lines).strip()


def _normalize_report_response(report: ExplorationReport) -> ExplorationReportResponse:
    payload = ExplorationReportResponse.model_validate(report)
    normalized = payload.model_dump()
    normalized["highlights"] = [
        item for item in (normalize_bullet_item(raw) for raw in (payload.highlights or [])) if item
    ]
    normalized["technical_analysis"] = to_markdown_text(payload.technical_analysis or "")
    normalized["performance_analysis"] = to_markdown_text(payload.performance_analysis or "")
    normalized["code_analysis"] = to_markdown_text(payload.code_analysis or "")

    full_report = to_markdown_text(payload.full_report or "")
    if not full_report or not looks_like_markdown(full_report):
        summary_md = _render_summary_markdown(payload)
        full_report = (
            f"# {payload.title}\n\n"
            f"{summary_md}\n\n"
            f"## 技术分析\n{normalized['technical_analysis'] or '暂无'}\n\n"
            f"## 性能分析\n{normalized['performance_analysis'] or '暂无'}\n\n"
            f"## 代码分析\n{normalized['code_analysis'] or '暂无'}\n"
        )
    normalized["full_report"] = full_report
    return ExplorationReportResponse(**normalized)


def _run_exploration_background(task_id: str, request_data: dict) -> None:
    """后台执行探索任务"""
    service = get_exploration_service()
    service.run_task(
        task_id=task_id,
        sources=request_data["sources"],
        min_score=request_data["min_score"],
        days_back=request_data["days_back"],
        max_results_per_source=request_data["max_results_per_source"],
        keywords=request_data.get("keywords"),
        watch_organizations=request_data.get("watch_organizations"),
        run_mode=request_data.get("run_mode", "auto"),
    )


def _run_manual_report_background(task_id: str, model_id: int, run_mode: str) -> None:
    """后台执行手动报告生成任务"""
    service = get_exploration_service()
    service.run_manual_report_task(task_id=task_id, model_id=model_id, run_mode=run_mode)


@router.post("/start", response_model=ExplorationTaskStartResponse)
async def start_exploration(
    request: ExplorationTaskCreate,
    db: Session = Depends(get_database),
    current_user: str = Depends(require_auth),
) -> ExplorationTaskStartResponse:
    """
    启动模型先知任务
    """
    del current_user

    with _EXPLORATION_START_LOCK:
        _cleanup_stale_active_tasks(db)
        active_task = _find_active_exploration_task(db)
        if active_task:
            raise HTTPException(
                status_code=409,
                detail=f"已有探索任务执行中：{active_task.task_id}",
            )

        task_id = f"explore-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8]}"
        task = ExplorationTask(
            task_id=task_id,
            status="pending",
            source=",".join(request.sources),
            model_name="pending",
            discovery_time=datetime.now(),
            progress={
                "current_stage": "queued",
                "requested_mode": request.run_mode,
                "models_discovered": 0,
                "models_evaluated": 0,
                "updates_detected": 0,
                "release_candidates": 0,
                "notable_models": 0,
                "reports_generated": 0,
                "source_results": {},
                "watch_organizations": request.watch_organizations or [],
            },
        )

        db.add(task)
        db.commit()

        _submit_background_task(task_id, _run_exploration_background, task_id, request.model_dump())
    return ExplorationTaskStartResponse(task_id=task_id, status="started", message="模型先知任务已启动")


@router.get("/tasks/{task_id}", response_model=ExplorationTaskResponse)
async def get_task_status(
    task_id: str,
    db: Session = Depends(get_database),
) -> ExplorationTaskResponse:
    """
    获取任务状态
    """
    task = db.query(ExplorationTask).filter(ExplorationTask.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return ExplorationTaskResponse.model_validate(task)


@router.get("/tasks", response_model=ExplorationTaskListResponse)
async def list_tasks(
    status: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_database),
) -> ExplorationTaskListResponse:
    """
    获取任务列表
    """
    query = db.query(ExplorationTask)
    if status:
        query = query.filter(ExplorationTask.status == status)

    total = query.count()
    tasks = query.order_by(ExplorationTask.created_at.desc()).offset(offset).limit(limit).all()
    return ExplorationTaskListResponse(
        tasks=[ExplorationTaskResponse.model_validate(item) for item in tasks],
        total=total,
        page=offset // limit + 1,
    )


@router.get("/models", response_model=DiscoveredModelListResponse)
async def list_models(
    sort_by: ExplorationModelSortBy = Query("final_score"),
    order: ExplorationOrderBy = Query("desc"),
    min_score: Optional[float] = None,
    min_release_confidence: Optional[float] = Query(None, ge=0.0, le=100.0),
    model_type: Optional[str] = None,
    source_platform: Optional[str] = None,
    is_notable: Optional[bool] = None,
    has_report: Optional[bool] = None,
    q: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_database),
) -> DiscoveredModelListResponse:
    """
    获取发现模型列表
    """
    query = db.query(DiscoveredModel)

    if min_score is not None:
        query = query.filter(DiscoveredModel.final_score >= min_score)
    if min_release_confidence is not None:
        release_confidence_expr = cast(
            func.json_extract(DiscoveredModel.extra_data, "$.release_confidence"),
            Float,
        )
        query = query.filter(release_confidence_expr >= min_release_confidence)
    if model_type:
        query = query.filter(DiscoveredModel.model_type == model_type)
    if source_platform:
        query = query.filter(DiscoveredModel.source_platform == source_platform)
    if is_notable is not None:
        query = query.filter(DiscoveredModel.is_notable == is_notable)
    if has_report is not None:
        report_exists = (
            db.query(ExplorationReport.id)
            .filter(ExplorationReport.model_id == DiscoveredModel.id)
            .exists()
        )
        if has_report:
            query = query.filter(report_exists)
        else:
            query = query.filter(~report_exists)
    if q:
        like_pattern = f"%{q.strip()}%"
        query = query.filter(
            DiscoveredModel.model_name.ilike(like_pattern)
            | DiscoveredModel.organization.ilike(like_pattern)
        )

    sort_column = getattr(DiscoveredModel, sort_by)
    if order == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    total = query.count()
    models = query.offset(offset).limit(limit).all()
    return DiscoveredModelListResponse(
        models=[DiscoveredModelResponse.model_validate(item) for item in models],
        total=total,
        page=offset // limit + 1,
    )


@router.get("/models/{model_id}", response_model=ExplorationModelDetailResponse)
async def get_model_detail(
    model_id: int,
    db: Session = Depends(get_database),
) -> ExplorationModelDetailResponse:
    """
    获取模型详情
    """
    model = db.query(DiscoveredModel).filter(DiscoveredModel.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")

    reports = (
        db.query(ExplorationReport)
        .filter(ExplorationReport.model_id == model_id)
        .order_by(ExplorationReport.generated_at.desc())
        .all()
    )
    return ExplorationModelDetailResponse(
        model=DiscoveredModelResponse.model_validate(model),
        reports=[ExplorationReportSummaryResponse.model_validate(item) for item in reports],
    )


@router.post("/models/{model_id}/mark")
async def mark_model(
    model_id: int,
    request: ExplorationModelMarkRequest,
    db: Session = Depends(get_database),
    current_user: str = Depends(require_auth),
) -> dict:
    """
    手动标记模型
    """
    del current_user

    model = db.query(DiscoveredModel).filter(DiscoveredModel.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")

    model.is_notable = request.is_notable
    extra_data = model.extra_data or {}
    if request.notes:
        extra_data["user_notes"] = request.notes
    model.extra_data = extra_data
    db.commit()
    return {"message": "标记成功", "model_id": model_id}


@router.post("/models/{model_id}/generate-report", response_model=ExplorationGenerateReportResponse)
async def generate_report_for_model(
    model_id: int,
    run_mode: Literal["auto", "deterministic", "agent"] = Query("auto"),
    db: Session = Depends(get_database),
    current_user: str = Depends(require_auth),
) -> ExplorationGenerateReportResponse:
    """
    手动为指定模型生成报告
    """
    del current_user

    model = db.query(DiscoveredModel).filter(DiscoveredModel.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")

    with _MANUAL_REPORT_LOCK:
        _cleanup_stale_active_tasks(db)
        active_task = _find_active_manual_report_task(db, model_id=model_id)
        if active_task:
            raise HTTPException(
                status_code=409,
                detail=f"该模型已有报告任务执行中：{active_task.task_id}",
            )

        task_id = f"report-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8]}"
        task = ExplorationTask(
            task_id=task_id,
            status="pending",
            source="manual-report",
            model_name=model.model_name or f"model-{model_id}",
            model_url=model.model_url or model.github_url or model.paper_url,
            discovery_time=datetime.now(),
            progress={
                "current_stage": "queued",
                "requested_mode": run_mode,
                "models_discovered": 0,
                "models_evaluated": 0,
                "updates_detected": 0,
                "release_candidates": 0,
                "notable_models": 0,
                "reports_generated": 0,
                "source_results": {},
                "model_id": model_id,
            },
        )
        db.add(task)
        db.commit()

        _submit_background_task(task_id, _run_manual_report_background, task_id, model_id, run_mode)

    return ExplorationGenerateReportResponse(
        message="报告生成任务已提交",
        model_id=model_id,
        task_id=task_id,
        report_id=None,
        status="queued",
    )


@router.get("/reports", response_model=ExplorationReportListResponse)
async def list_reports(
    model_id: Optional[int] = None,
    sort_by: str = Query("generated_at", pattern="^(generated_at)$"),
    order: ExplorationOrderBy = Query("desc"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_database),
) -> ExplorationReportListResponse:
    """
    获取报告列表
    """
    query = db.query(ExplorationReport)
    if model_id is not None:
        query = query.filter(ExplorationReport.model_id == model_id)

    sort_column = getattr(ExplorationReport, sort_by)
    if order == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    total = query.count()
    reports = query.offset(offset).limit(limit).all()
    return ExplorationReportListResponse(
        reports=[ExplorationReportSummaryResponse.model_validate(item) for item in reports],
        total=total,
        page=offset // limit + 1,
    )


@router.get("/reports/{report_id}", response_model=ExplorationReportResponse)
async def get_report_detail(
    report_id: str,
    db: Session = Depends(get_database),
) -> ExplorationReportResponse:
    """
    获取报告详情
    """
    report = db.query(ExplorationReport).filter(ExplorationReport.report_id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")
    return _normalize_report_response(report)


@router.delete("/reports/{report_id}")
async def delete_report(
    report_id: str,
    db: Session = Depends(get_database),
    current_user: str = Depends(require_auth),
) -> dict:
    """
    删除报告
    """
    del current_user

    report = db.query(ExplorationReport).filter(ExplorationReport.report_id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")

    model_id = report.model_id
    model = db.query(DiscoveredModel).filter(DiscoveredModel.id == model_id).first()
    db.delete(report)
    db.flush()

    remain_reports = 0
    if model:
        remain_reports = (
            db.query(ExplorationReport)
            .filter(ExplorationReport.model_id == model.id)
            .count()
        )
        if remain_reports == 0 and model.status == "reported":
            model.status = "evaluated"

    db.commit()
    return {
        "message": "报告已删除",
        "report_id": report_id,
        "model_id": model_id,
        "remaining_reports": int(remain_reports),
    }


@router.get("/reports/{report_id}/export")
async def export_report(
    report_id: str,
    db: Session = Depends(get_database),
) -> Response:
    """
    导出报告（Markdown）
    """
    report = db.query(ExplorationReport).filter(ExplorationReport.report_id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")
    normalized = _normalize_report_response(report)
    return Response(
        content=normalized.full_report or "报告内容为空",
        media_type="text/markdown",
        headers={"Content-Disposition": f"attachment; filename={report_id}.md"},
    )


@router.get("/statistics", response_model=ExplorationStatisticsResponse)
async def get_statistics(
    db: Session = Depends(get_database),
) -> ExplorationStatisticsResponse:
    """
    获取探索统计
    """
    report_exists = (
        db.query(ExplorationReport.id)
        .filter(ExplorationReport.model_id == DiscoveredModel.id)
        .exists()
    )

    # 当前值口径：仅统计当前仍有报告的模型
    total_models = (
        db.query(func.count(DiscoveredModel.id))
        .filter(report_exists)
        .scalar()
        or 0
    )
    notable_models = (
        db.query(func.count(DiscoveredModel.id))
        .filter(report_exists, DiscoveredModel.is_notable.is_(True))
        .scalar()
        or 0
    )
    reports_generated = db.query(func.count(ExplorationReport.id)).scalar() or 0
    avg_final_score = (
        db.query(func.avg(DiscoveredModel.final_score))
        .filter(report_exists)
        .scalar()
        or 0.0
    )

    by_source = {
        platform: count
        for platform, count in db.query(
            DiscoveredModel.source_platform,
            func.count(DiscoveredModel.id),
        )
        .filter(report_exists)
        .group_by(DiscoveredModel.source_platform)
        .all()
    }

    by_model_type = {
        model_type or "Unknown": count
        for model_type, count in db.query(
            DiscoveredModel.model_type,
            func.count(DiscoveredModel.id),
        )
        .filter(report_exists)
        .group_by(DiscoveredModel.model_type)
        .all()
    }

    return ExplorationStatisticsResponse(
        total_models_discovered=int(total_models),
        notable_models=int(notable_models),
        reports_generated=int(reports_generated),
        avg_final_score=round(float(avg_final_score), 2),
        by_source=by_source,
        by_model_type=by_model_type,
    )
