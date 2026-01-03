"""
采集相关 API 端点
"""
from datetime import datetime, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
import sys
from pathlib import Path
import threading
import logging

# 添加项目根目录到路径
# __file__ = backend/app/api/v1/endpoints/collection.py
# 需要 6 个 parent 到达项目根目录
project_root = Path(__file__).parent.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.app.db.repositories import CollectionTaskRepository, CollectionLogRepository
from backend.app.db.models import CollectionTask, CollectionLog, Article
from backend.app.core.dependencies import get_database, get_collection_service
from backend.app.schemas.collection import (
    CollectionTask as CollectionTaskSchema,
    CollectionTaskCreate,
    CollectionTaskStatus,
    CollectionStats,
)
from backend.app.services.collector import CollectionService
from backend.app.db import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

# 全局变量存储当前运行的任务
_running_tasks = {}
_task_lock = threading.Lock()


def _run_collection_background(
    task_id: int,
    enable_ai: bool,
    collection_service: CollectionService,
):
    """后台运行采集任务"""
    try:
        db = get_db()
        
        # 执行采集
        stats = collection_service.collect_all(
            enable_ai_analysis=enable_ai,
            task_id=task_id,
        )
        
        # 更新任务状态
        with db.get_session() as session:
            task = session.query(CollectionTask).filter(CollectionTask.id == task_id).first()
            if task:
                task.status = "completed"
                task.new_articles_count = stats.get('new_articles', 0)
                task.total_sources = stats.get('sources_success', 0) + stats.get('sources_error', 0)
                task.success_sources = stats.get('sources_success', 0)
                task.failed_sources = stats.get('sources_error', 0)
                task.duration = stats.get('duration', 0)
                task.completed_at = datetime.now()
                task.ai_analyzed_count = stats.get('ai_analyzed_count', 0)
                session.commit()
        
        # 从运行任务中移除
        with _task_lock:
            if task_id in _running_tasks:
                del _running_tasks[task_id]
                
    except Exception as e:
        # 更新任务状态为错误
        db = get_db()
        with db.get_session() as session:
            task = session.query(CollectionTask).filter(CollectionTask.id == task_id).first()
            if task:
                task.status = "error"
                task.error_message = str(e)
                task.completed_at = datetime.now()
                session.commit()
        
        # 从运行任务中移除
        with _task_lock:
            if task_id in _running_tasks:
                del _running_tasks[task_id]


@router.post("/start", response_model=CollectionTaskSchema)
async def start_collection(
    request: CollectionTaskCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_database),
    collection_service: CollectionService = Depends(get_collection_service),
):
    """启动采集任务"""
    # 先检查并恢复挂起的任务
    from backend.app.db import get_db
    db_manager = get_db()
    collection_service._recover_stuck_tasks(db_manager)
    
    # 检查内存中是否有正在运行的任务（验证线程是否存活）
    with _task_lock:
        active_tasks = {}
        for task_id, thread in list(_running_tasks.items()):
            if thread.is_alive():
                active_tasks[task_id] = thread
            else:
                # 线程已死，但任务可能还在running状态
                logger.warning(f"⚠️  发现已停止的线程对应的任务 (ID: {task_id})，将从运行列表中移除")
        _running_tasks.clear()
        _running_tasks.update(active_tasks)
        
        if _running_tasks:
            raise HTTPException(
                status_code=400,
                detail="已有采集任务正在运行，请等待完成后再启动新任务"
            )
    
    # 检查数据库中是否还有running状态的任务（恢复后应该没有了，但再次确认）
    running_task = db.query(CollectionTask).filter(
        CollectionTask.status == "running"
    ).order_by(CollectionTask.started_at.desc()).first()
    
    if running_task:
        # 如果还有running任务，说明可能是刚启动的（还没超时），不允许启动新任务
        raise HTTPException(
            status_code=400,
            detail="已有采集任务正在运行，请等待完成后再启动新任务"
        )
    
    # 创建任务记录
    task = CollectionTask(
        status="running",
        ai_enabled=request.enable_ai,
        started_at=datetime.now(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    
    # 在后台线程中运行采集
    thread = threading.Thread(
        target=_run_collection_background,
        args=(task.id, request.enable_ai, collection_service),
        daemon=True,
    )
    thread.start()
    
    # 记录运行中的任务
    with _task_lock:
        _running_tasks[task.id] = thread
    
    return CollectionTaskSchema.model_validate(task)


@router.get("/tasks", response_model=List[CollectionTaskSchema])
async def get_collection_tasks(
    limit: int = 50,
    db: Session = Depends(get_database),
):
    """获取采集历史"""
    tasks = CollectionTaskRepository.get_recent_tasks(db, limit=limit)
    return [CollectionTaskSchema.model_validate(task) for task in tasks]


@router.get("/tasks/{task_id}", response_model=CollectionTaskSchema)
async def get_collection_task(
    task_id: int,
    db: Session = Depends(get_database),
):
    """获取采集任务详情"""
    task = db.query(CollectionTask).filter(CollectionTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return CollectionTaskSchema.model_validate(task)


@router.post("/tasks/recover-stuck")
async def recover_stuck_tasks(
    db: Session = Depends(get_database),
    collection_service: CollectionService = Depends(get_collection_service),
):
    """手动恢复所有挂起的采集任务"""
    from backend.app.db import get_db
    db_manager = get_db()
    
    try:
        # 调用恢复方法
        collection_service._recover_stuck_tasks(db_manager)
        
        # 查询恢复后的结果
        stuck_tasks = db.query(CollectionTask).filter(
            CollectionTask.status == "running"
        ).all()
        
        if stuck_tasks:
            # 检查是否有超时的任务
            current_time = datetime.now()
            timeout_threshold = timedelta(hours=1)
            recovered_count = 0
            
            for task in stuck_tasks:
                running_time = current_time - task.started_at
                if running_time > timeout_threshold:
                    # 手动恢复这个任务
                    task.status = "error"
                    task.error_message = f"手动恢复：任务超时中断（运行时间超过{timeout_threshold.total_seconds()/3600:.1f}小时）"
                    task.completed_at = current_time
                    recovered_count += 1
            
            if recovered_count > 0:
                db.commit()
                return {
                    "message": f"已恢复 {recovered_count} 个挂起的任务",
                    "recovered_count": recovered_count
                }
            else:
                return {
                    "message": "没有发现需要恢复的挂起任务（所有running任务都在1小时内）",
                    "running_tasks": len(stuck_tasks)
                }
        else:
            return {
                "message": "没有发现挂起的任务",
                "recovered_count": 0
            }
    except Exception as e:
        logger.error(f"恢复挂起任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"恢复挂起任务失败: {str(e)}")


@router.get("/tasks/{task_id}/detail")
async def get_collection_task_detail(
    task_id: int,
    db: Session = Depends(get_database),
):
    """获取采集任务详细信息（包括日志和新增文章）"""
    task = db.query(CollectionTask).filter(CollectionTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    # 获取采集日志
    logs = CollectionLogRepository.get_logs_for_task(db, task)
    
    # 获取新增的文章（根据任务时间范围）
    articles_query = db.query(Article).filter(
        Article.collected_at >= task.started_at
    )
    if task.completed_at:
        articles_query = articles_query.filter(Article.collected_at <= task.completed_at)
    else:
        # 如果任务未完成，只获取开始时间后1小时内的文章（避免获取过多）
        from datetime import timedelta
        end_time = task.started_at + timedelta(hours=1)
        articles_query = articles_query.filter(Article.collected_at <= end_time)
    
    # 先统计总数
    total_articles_count = articles_query.count()
    
    # 然后获取文章列表（用于显示）
    articles = articles_query.order_by(Article.collected_at.desc()).limit(100).all()
    
    # 分离成功和失败的日志（去重，每个源只保留一条日志）
    # 重要：一个源不应该同时出现在成功和失败列表中
    # 优先保留成功日志（如果源有成功日志，就不显示失败日志）
    # 使用字典去重，保留最新的日志（按 started_at 降序排序后取第一条）
    sorted_logs = sorted(logs, key=lambda x: x.started_at if x.started_at else datetime.min, reverse=True)
    
    # 先处理所有日志，按源名称分组，每个源只保留一条最新的日志
    source_logs_dict = {}
    for log in sorted_logs:
        source_name = log.source_name
        # 如果该源还没有日志，或者当前日志更新，则更新
        if source_name not in source_logs_dict:
            source_logs_dict[source_name] = log
        elif log.started_at and source_logs_dict[source_name].started_at:
            if log.started_at > source_logs_dict[source_name].started_at:
                source_logs_dict[source_name] = log
    
    # 然后分离成功和失败的日志
    # 优先保留成功日志：如果源有成功日志，就不显示失败日志
    success_logs = []
    failed_logs = []
    processed_sources = set()
    
    # 先收集所有成功日志
    for log in source_logs_dict.values():
        if log.status == 'success':
            success_logs.append(log)
            processed_sources.add(log.source_name)
    
    # 再收集失败日志（排除已有成功日志的源）
    for log in source_logs_dict.values():
        if log.status == 'error' and log.source_name not in processed_sources:
            failed_logs.append(log)
    
    # 重要：使用任务表中的统计数据作为标准（因为它是准确的）
    # 如果日志去重后的数量与任务表不一致，说明日志记录有问题
    # 但我们仍然显示所有去重后的日志，让用户能看到实际情况
    # 标签页的数量显示使用任务表中的统计数据
    
    return {
        "task": CollectionTaskSchema.model_validate(task),
        "logs": [
            {
                "id": log.id,
                "source_name": log.source_name,
                "source_type": log.source_type,
                "status": log.status,
                "articles_count": log.articles_count,
                "error_message": log.error_message,
                "started_at": log.started_at.isoformat() if log.started_at else None,
                "completed_at": log.completed_at.isoformat() if log.completed_at else None,
            }
            for log in logs
        ],
        "success_logs": [
            {
                "id": log.id,
                "source_name": log.source_name,
                "source_type": log.source_type,
                "articles_count": log.articles_count,
                "started_at": log.started_at.isoformat() if log.started_at else None,
                "completed_at": log.completed_at.isoformat() if log.completed_at else None,
            }
            for log in success_logs
        ],
        "failed_logs": [
            {
                "id": log.id,
                "source_name": log.source_name,
                "source_type": log.source_type,
                "error_message": log.error_message,
                "started_at": log.started_at.isoformat() if log.started_at else None,
                "completed_at": log.completed_at.isoformat() if log.completed_at else None,
            }
            for log in failed_logs
        ],
        "new_articles": [
            {
                "id": article.id,
                "title": article.title,
                "url": article.url,
                "source": article.source,
                "published_at": article.published_at.isoformat() if article.published_at else None,
                "collected_at": article.collected_at.isoformat() if article.collected_at else None,
            }
            for article in articles
        ],
        # 使用任务表中的统计数据，确保与列表显示一致
        "success_sources_count": task.success_sources,
        "failed_sources_count": task.failed_sources,
        "new_articles_count": task.new_articles_count,
        "total_articles_count": total_articles_count,  # 实际查询到的文章总数
    }


@router.get("/status", response_model=CollectionTaskStatus)
async def get_collection_status(
    db: Session = Depends(get_database),
):
    """获取当前采集状态"""
    # 检查是否有运行中的任务
    with _task_lock:
        running_task_ids = list(_running_tasks.keys())
    
    if running_task_ids:
        # 获取最新的运行中任务
        task = db.query(CollectionTask).filter(
            CollectionTask.id == running_task_ids[0]
        ).first()
        if task:
            return CollectionTaskStatus(
                task_id=task.id,
                status=task.status,
                message="采集进行中...",
            )
    
    # 获取最新的任务
    latest_task = CollectionTaskRepository.get_latest_task(db)
    if latest_task:
        if latest_task.status == "completed":
            message = f"✅ 采集完成！新增 {latest_task.new_articles_count} 篇文章，耗时 {latest_task.duration or 0:.1f}秒"
        elif latest_task.status == "error":
            message = f"❌ 采集失败: {latest_task.error_message}"
        else:
            message = "采集进行中..."
        
        return CollectionTaskStatus(
            task_id=latest_task.id,
            status=latest_task.status,
            message=message,
        )
    
    return CollectionTaskStatus(
        task_id=0,
        status="idle",
        message="暂无采集任务",
    )

