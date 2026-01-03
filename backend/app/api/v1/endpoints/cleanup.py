"""
数据清理相关 API 端点
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import sys
from pathlib import Path

# 添加项目根目录到路径
# __file__ = backend/app/api/v1/endpoints/cleanup.py
# 需要 6 个 parent 到达项目根目录
project_root = Path(__file__).parent.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.app.db.models import Article, CollectionLog, NotificationLog, RSSSource
from backend.app.core.dependencies import get_database
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()


class CleanupRequest(BaseModel):
    """清理请求"""
    delete_articles_older_than_days: int = None
    delete_logs_older_than_days: int = None
    delete_unanalyzed_articles: bool = False
    delete_articles_by_sources: Optional[List[str]] = None  # 订阅源名称列表


class CleanupResponse(BaseModel):
    """清理响应"""
    deleted_articles: int = 0
    deleted_logs: int = 0
    deleted_notification_logs: int = 0
    message: str


@router.post("", response_model=CleanupResponse)
async def cleanup_data(
    request: CleanupRequest,
    db: Session = Depends(get_database),
):
    """执行数据清理"""
    deleted_articles = 0
    deleted_logs = 0
    deleted_notification_logs = 0
    
    try:
        # 清理指定订阅源的文章
        if request.delete_articles_by_sources and len(request.delete_articles_by_sources) > 0:
            # 根据订阅源名称查找对应的source_id
            sources = db.query(RSSSource).filter(
                RSSSource.name.in_(request.delete_articles_by_sources)
            ).all()
            source_ids = [source.id for source in sources]
            source_names = [source.name for source in sources]
            
            if source_ids or source_names:
                # 使用OR条件删除：source_id匹配或source名称匹配（避免重复删除）
                from sqlalchemy import or_
                
                conditions = []
                if source_ids:
                    conditions.append(Article.source_id.in_(source_ids))
                if source_names:
                    conditions.append(Article.source.in_(source_names))
                
                if conditions:
                    count = db.query(Article).filter(
                        or_(*conditions)
                    ).delete(synchronize_session=False)
                    deleted_articles += count
        
        # 清理旧文章
        if request.delete_articles_older_than_days:
            threshold = datetime.now() - timedelta(days=request.delete_articles_older_than_days)
            deleted_articles += db.query(Article).filter(
                Article.created_at < threshold
            ).delete(synchronize_session=False)
        
        # 清理未分析的文章
        if request.delete_unanalyzed_articles:
            deleted_articles += db.query(Article).filter(
                Article.is_processed == False
            ).delete(synchronize_session=False)
        
        # 清理旧日志
        if request.delete_logs_older_than_days:
            threshold = datetime.now() - timedelta(days=request.delete_logs_older_than_days)
            deleted_logs = db.query(CollectionLog).filter(
                CollectionLog.started_at < threshold
            ).delete()
            deleted_notification_logs = db.query(NotificationLog).filter(
                NotificationLog.sent_at < threshold
            ).delete()
        
        db.commit()
        
        message = f"清理完成：删除 {deleted_articles} 篇文章，{deleted_logs} 条采集日志，{deleted_notification_logs} 条通知日志"
        
        return CleanupResponse(
            deleted_articles=deleted_articles,
            deleted_logs=deleted_logs,
            deleted_notification_logs=deleted_notification_logs,
            message=message,
        )
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"清理失败: {str(e)}")

