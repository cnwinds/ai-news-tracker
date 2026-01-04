"""
统计相关 API 端点
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime
from backend.app.core.paths import setup_python_path

# 确保项目根目录在 Python 路径中
setup_python_path()

from backend.app.db.repositories import ArticleRepository
from backend.app.db.models import Article
from backend.app.core.dependencies import get_database
from backend.app.schemas.statistics import Statistics

router = APIRouter()


@router.get("", response_model=Statistics)
async def get_statistics(
    db: Session = Depends(get_database),
):
    """获取统计数据"""
    # 基础统计
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    
    total_articles = db.query(Article).count()
    today_count = db.query(Article).filter(Article.created_at >= today_start).count()
    
    # 重要性统计
    high_importance = db.query(Article).filter(Article.importance == "high").count()
    medium_importance = db.query(Article).filter(Article.importance == "medium").count()
    low_importance = db.query(Article).filter(Article.importance == "low").count()
    unanalyzed = db.query(Article).filter(Article.is_processed == False).count()
    
    # 来源分布
    source_counts = (
        db.query(Article.source, func.count(Article.id).label('count'))
        .group_by(Article.source)
        .all()
    )
    source_distribution = {source: count for source, count in source_counts}
    
    # 分类分布
    category_counts = (
        db.query(Article.category, func.count(Article.id).label('count'))
        .filter(Article.category.isnot(None))
        .group_by(Article.category)
        .all()
    )
    category_distribution = {category: count for category, count in category_counts if category}
    
    # 重要性分布
    importance_distribution = {
        "high": high_importance,
        "medium": medium_importance,
        "low": low_importance,
        "unanalyzed": unanalyzed,
    }
    
    return Statistics(
        total_articles=total_articles,
        today_count=today_count,
        high_importance=high_importance,
        medium_importance=medium_importance,
        low_importance=low_importance,
        unanalyzed=unanalyzed,
        source_distribution=source_distribution,
        category_distribution=category_distribution,
        importance_distribution=importance_distribution,
    )

