"""
数据清理相关 API 端点
"""
import asyncio
import json
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.api.v1.endpoints.settings import require_auth
from backend.app.core.dependencies import get_database
from backend.app.db.models import (
    Article,
    ArticleEmbedding,
    CollectionLog,
    NotificationLog,
    RSSSource,
)
from backend.app.utils import create_ai_analyzer

router = APIRouter()


class CleanupRequest(BaseModel):
    """清理请求"""
    delete_articles_older_than_days: Optional[int] = None
    delete_logs_older_than_days: Optional[int] = None
    delete_unanalyzed_articles: bool = False
    delete_articles_by_sources: Optional[List[str]] = None  # 订阅源名称列表
    rerun_unanalyzed_articles: bool = False  # 一键重跑未分析文章


class CleanupResponse(BaseModel):
    """清理响应"""
    deleted_articles: int = 0
    deleted_logs: int = 0
    deleted_notification_logs: int = 0
    rerun_analyzed_articles: int = 0
    rerun_failed_articles: int = 0
    message: str


def _normalize_summary(summary_value) -> str:
    """规范化 summary 字段为字符串格式"""
    if isinstance(summary_value, dict):
        return json.dumps(summary_value, ensure_ascii=False)
    if not isinstance(summary_value, str):
        return str(summary_value) if summary_value else ""
    return summary_value


@router.post("", response_model=CleanupResponse)
async def cleanup_data(
    request: CleanupRequest,
    db: Session = Depends(get_database),
    current_user: str = Depends(require_auth),
):
    """执行数据清理"""
    deleted_articles = 0
    deleted_logs = 0
    deleted_notification_logs = 0
    rerun_analyzed_articles = 0
    rerun_failed_articles = 0
    
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
                    # 先获取要删除的文章ID列表
                    article_ids = [a.id for a in db.query(Article.id).filter(or_(*conditions)).all()]
                    # 删除关联的 ArticleEmbedding 记录
                    if article_ids:
                        db.query(ArticleEmbedding).filter(
                            ArticleEmbedding.article_id.in_(article_ids)
                        ).delete(synchronize_session=False)
                        # 删除 vec_embeddings 表中的相关记录
                        try:
                            from sqlalchemy import text
                            db.execute(
                                text("DELETE FROM vec_embeddings WHERE article_id IN :article_ids"),
                                {"article_ids": tuple(article_ids)}
                            )
                        except Exception:
                            pass
                    
                    count = db.query(Article).filter(
                        or_(*conditions)
                    ).delete(synchronize_session=False)
                    deleted_articles += count
        
        # 清理旧文章
        if request.delete_articles_older_than_days:
            threshold = datetime.now() - timedelta(days=request.delete_articles_older_than_days)
            # 先获取要删除的文章ID列表
            article_ids = [a.id for a in db.query(Article.id).filter(
                Article.created_at < threshold
            ).all()]
            # 删除关联的 ArticleEmbedding 记录
            if article_ids:
                db.query(ArticleEmbedding).filter(
                    ArticleEmbedding.article_id.in_(article_ids)
                ).delete(synchronize_session=False)
                # 删除 vec_embeddings 表中的相关记录
                try:
                    from sqlalchemy import text
                    db.execute(
                        text("DELETE FROM vec_embeddings WHERE article_id IN :article_ids"),
                        {"article_ids": tuple(article_ids)}
                    )
                except Exception:
                    pass
            
            deleted_articles += db.query(Article).filter(
                Article.created_at < threshold
            ).delete(synchronize_session=False)
        
        # 清理未分析的文章
        if request.delete_unanalyzed_articles:
            # 先获取要删除的文章ID列表
            article_ids = [a.id for a in db.query(Article.id).filter(
                Article.is_processed == False
            ).all()]
            # 删除关联的 ArticleEmbedding 记录
            if article_ids:
                db.query(ArticleEmbedding).filter(
                    ArticleEmbedding.article_id.in_(article_ids)
                ).delete(synchronize_session=False)
                # 删除 vec_embeddings 表中的相关记录
                try:
                    from sqlalchemy import text
                    db.execute(
                        text("DELETE FROM vec_embeddings WHERE article_id IN :article_ids"),
                        {"article_ids": tuple(article_ids)}
                    )
                except Exception:
                    pass
            
            deleted_articles += db.query(Article).filter(
                Article.is_processed == False
            ).delete(synchronize_session=False)

        # 一键重跑未分析文章
        if request.rerun_unanalyzed_articles:
            ai_analyzer = create_ai_analyzer()
            if not ai_analyzer:
                raise HTTPException(status_code=400, detail="未配置AI分析器")

            unanalyzed_articles = db.query(Article).filter(
                Article.is_processed == False,
                Article.content.isnot(None),
                Article.content != ""
            ).all()

            for article in unanalyzed_articles:
                try:
                    analysis_result = await asyncio.to_thread(
                        ai_analyzer.analyze_article,
                        title=article.title,
                        content=article.content or "",
                        url=article.url,
                        source=article.source,
                        category=article.category,
                    )

                    article.importance = analysis_result.get("importance")
                    article.tags = analysis_result.get("tags", [])
                    article.target_audience = analysis_result.get("target_audience")
                    if analysis_result.get("title_zh"):
                        article.title_zh = analysis_result.get("title_zh")
                    article.summary = _normalize_summary(analysis_result.get("summary", ""))
                    article.detailed_summary = _normalize_summary(analysis_result.get("detailed_summary", ""))
                    article.is_processed = True
                    article.updated_at = datetime.now()
                    rerun_analyzed_articles += 1
                except Exception:
                    rerun_failed_articles += 1
        
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

        if request.rerun_unanalyzed_articles:
            message = (
                f"执行完成：删除 {deleted_articles} 篇文章，{deleted_logs} 条采集日志，"
                f"{deleted_notification_logs} 条通知日志；"
                f"重跑AI分析成功 {rerun_analyzed_articles} 篇，失败 {rerun_failed_articles} 篇"
            )
        else:
            message = f"清理完成：删除 {deleted_articles} 篇文章，{deleted_logs} 条采集日志，{deleted_notification_logs} 条通知日志"
        
        return CleanupResponse(
            deleted_articles=deleted_articles,
            deleted_logs=deleted_logs,
            deleted_notification_logs=deleted_notification_logs,
            rerun_analyzed_articles=rerun_analyzed_articles,
            rerun_failed_articles=rerun_failed_articles,
            message=message,
        )
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"清理失败: {str(e)}")
