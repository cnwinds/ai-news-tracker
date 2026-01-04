"""
文章相关 API 端点
"""
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from backend.app.core.paths import setup_python_path

# 确保项目根目录在 Python 路径中
setup_python_path()

from backend.app.db.repositories import ArticleRepository
from backend.app.db.models import Article
from backend.app.core.dependencies import get_database
from backend.app.schemas.article import (
    Article as ArticleSchema,
    ArticleListResponse,
    ArticleFilter,
)
from backend.app.utils import create_ai_analyzer

router = APIRouter()


def _parse_time_range(time_range: str) -> Optional[datetime]:
    """解析时间范围字符串"""
    now = datetime.now()
    if time_range == "今天":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif time_range == "最近3天":
        return now - timedelta(days=3)
    elif time_range == "最近7天":
        return now - timedelta(days=7)
    elif time_range == "最近30天":
        return now - timedelta(days=30)
    elif time_range == "全部":
        return None
    return None


@router.get("", response_model=ArticleListResponse)
async def get_articles(
    time_range: Optional[str] = Query(None, description="时间范围"),
    sources: Optional[str] = Query(None, description="来源列表，逗号分隔"),
    importance: Optional[str] = Query(None, description="重要性列表，逗号分隔"),
    category: Optional[str] = Query(None, description="分类列表，逗号分隔"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_database),
):
    """获取文章列表（支持筛选和分页）"""
    # 解析筛选参数
    time_threshold = _parse_time_range(time_range) if time_range else None
    sources_list = sources.split(",") if sources else None
    importance_list = importance.split(",") if importance else None
    category_list = category.split(",") if category else None
    
    # 处理"未分析"重要性
    include_unimportance = False
    if importance_list and "未分析" in importance_list:
        include_unimportance = True
        importance_list = [i for i in importance_list if i != "未分析"]
    
    # 获取文章总数（用于分页）
    articles_query = db.query(Article)
    if time_threshold:
        articles_query = articles_query.filter(Article.published_at >= time_threshold)
    if sources_list:
        articles_query = articles_query.filter(Article.source.in_(sources_list))
    if importance_list or include_unimportance:
        if include_unimportance:
            if importance_list:
                articles_query = articles_query.filter(
                    (Article.importance.in_(importance_list)) | (Article.importance == None)
                )
            else:
                articles_query = articles_query.filter(Article.importance == None)
        else:
            articles_query = articles_query.filter(Article.importance.in_(importance_list))
    if category_list:
        articles_query = articles_query.filter(Article.category.in_(category_list))
    
    total = articles_query.count()
    
    # 获取分页数据
    articles = (
        articles_query
        .order_by(Article.published_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    
    # 转换为 Pydantic 模型
    article_schemas = [ArticleSchema.model_validate(article) for article in articles]
    
    total_pages = (total + page_size - 1) // page_size
    
    return ArticleListResponse(
        items=article_schemas,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/{article_id}", response_model=ArticleSchema)
async def get_article(
    article_id: int,
    db: Session = Depends(get_database),
):
    """获取文章详情"""
    article = db.query(Article).filter(Article.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    return ArticleSchema.model_validate(article)


@router.post("/{article_id}/analyze")
async def analyze_article(
    article_id: int,
    force: bool = Query(False, description="是否强制重新分析（即使已分析过）"),
    db: Session = Depends(get_database),
):
    """触发文章AI分析（支持重新分析）"""
    article = db.query(Article).filter(Article.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    
    # 如果已分析且未强制重新分析，返回提示信息
    was_processed = article.is_processed
    if was_processed and not force:
        return {
            "message": "文章已分析，如需重新分析请使用 force=true 参数",
            "article_id": article_id,
            "is_processed": True,
        }
    
    # 创建AI分析器
    ai_analyzer = create_ai_analyzer()
    if not ai_analyzer:
        raise HTTPException(status_code=400, detail="未配置AI分析器")
    
    try:
        # 执行AI分析
        analysis_result = ai_analyzer.analyze_article(
            title=article.title,
            content=article.content or "",
            url=article.url,
        )
        
        # 更新文章（无论是否已分析过，都更新）
        article.importance = analysis_result.get("importance")
        article.topics = analysis_result.get("topics", [])
        article.tags = analysis_result.get("tags", [])
        article.key_points = analysis_result.get("key_points", [])
        article.target_audience = analysis_result.get("target_audience")
        
        # 确保 summary 字段是字符串，而不是 JSON 对象
        summary_value = analysis_result.get("summary", "")
        if isinstance(summary_value, dict):
            # 如果 summary 是字典，转换为字符串
            import json
            summary_value = json.dumps(summary_value, ensure_ascii=False)
        elif not isinstance(summary_value, str):
            summary_value = str(summary_value) if summary_value else ""
        
        article.summary = summary_value
        article.is_processed = True
        article.updated_at = datetime.now()
        
        db.commit()
        
        return {
            "message": "重新分析完成" if was_processed else "分析完成",
            "article_id": article_id,
            "analysis": analysis_result,
            "is_processed": True,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


@router.delete("/{article_id}")
async def delete_article(
    article_id: int,
    db: Session = Depends(get_database),
):
    """删除文章"""
    success = ArticleRepository.delete_article(db, article_id)
    if not success:
        raise HTTPException(status_code=404, detail="文章不存在")
    return {"message": "文章已删除", "article_id": article_id}

