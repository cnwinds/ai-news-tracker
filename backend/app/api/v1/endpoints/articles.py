"""
文章相关 API 端点
"""
import json
import logging
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session

from backend.app.db.repositories import ArticleRepository
from backend.app.db.models import Article
from backend.app.core.dependencies import get_database
from backend.app.api.v1.endpoints.settings import require_auth
from backend.app.schemas.article import (
    Article as ArticleSchema,
    ArticleListResponse,
    ArticleUpdate,
)
from backend.app.utils import create_ai_analyzer

logger = logging.getLogger(__name__)

router = APIRouter()


def _normalize_summary(summary_value) -> str:
    """规范化 summary 字段为字符串格式"""
    if isinstance(summary_value, dict):
        return json.dumps(summary_value, ensure_ascii=False)
    elif not isinstance(summary_value, str):
        return str(summary_value) if summary_value else ""
    return summary_value


def _update_article_analysis(article: Article, analysis_result: dict) -> None:
    """更新文章的分析结果"""
    article.importance = analysis_result.get("importance")
    article.tags = analysis_result.get("tags", [])
    article.target_audience = analysis_result.get("target_audience")
    
    # 保存中文标题（如果AI分析返回了title_zh）
    if analysis_result.get("title_zh"):
        article.title_zh = analysis_result.get("title_zh")
    
    # 规范化 summary 字段
    article.summary = _normalize_summary(analysis_result.get("summary", ""))
    article.is_processed = True
    article.updated_at = datetime.now()


def _get_article_or_404(db: Session, article_id: int) -> Article:
    """获取文章，如果不存在则抛出404异常"""
    article = db.query(Article).filter(Article.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    return article


def _parse_time_range(time_range: str) -> Optional[datetime]:
    """解析时间范围字符串"""
    now = datetime.now()
    time_range_map = {
        "今天": lambda: now.replace(hour=0, minute=0, second=0, microsecond=0),
        "最近3天": lambda: now - timedelta(days=3),
        "最近7天": lambda: now - timedelta(days=7),
        "最近30天": lambda: now - timedelta(days=30),
        "全部": lambda: None,
    }
    parser = time_range_map.get(time_range)
    return parser() if parser else None


@router.get("", response_model=ArticleListResponse)
async def get_articles(
    time_range: Optional[str] = Query(None, description="时间范围"),
    sources: Optional[str] = Query(None, description="来源列表，逗号分隔"),
    exclude_sources: Optional[str] = Query(None, description="排除的来源列表，逗号分隔"),
    importance: Optional[str] = Query(None, description="重要性列表，逗号分隔"),
    category: Optional[str] = Query(None, description="分类列表，逗号分隔"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    include_details: bool = Query(False, description="是否包含详细信息（摘要、内容、主题、标签等）"),
    db: Session = Depends(get_database),
):
    """获取文章列表（支持筛选和分页）
    
    默认只返回标题行显示所需的基本字段，不返回详细信息以节省网络流量。
    详细信息包括：author, summary, content, tags, user_notes等。
    仅在需要时设置include_details=True，或使用/articles/{id}/fields接口按需获取。
    """
    # 解析筛选参数
    time_threshold = _parse_time_range(time_range) if time_range else None
    sources_list = sources.split(",") if sources else None
    exclude_sources_list = exclude_sources.split(",") if exclude_sources else None
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
    if exclude_sources_list:
        articles_query = articles_query.filter(~Article.source.in_(exclude_sources_list))
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
    article_schemas = []
    for article in articles:
        # 创建文章对象
        article_data = ArticleSchema.model_validate(article)
        # 如果不包含详细信息，清空所有详细字段
        if not include_details:
            update_data = {
                'content': None,
                'summary': None,
                'author': None,
                'tags': None,
                'user_notes': None,
                'target_audience': None,
            }
            article_data = article_data.model_copy(update=update_data)
        
        article_schemas.append(article_data)
    
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
    article = _get_article_or_404(db, article_id)
    return ArticleSchema.model_validate(article)


@router.post("/batch/basic", response_model=List[ArticleSchema])
async def get_articles_basic(
    article_ids: List[int] = Body(..., description="文章ID列表"),
    db: Session = Depends(get_database),
):
    """
    批量获取文章的基本信息（不包含详细字段，节省流量）
    
    只返回基本字段：id, title, title_zh, url, source, source_id, category, 
    published_at, collected_at, importance, is_processed, is_sent, is_favorited, 
    created_at, updated_at
    
    不返回详细字段：content, summary, author, tags, user_notes, target_audience等
    """
    if not article_ids:
        return []
    
    articles = db.query(Article).filter(Article.id.in_(article_ids)).all()
    
    # 转换为 Pydantic 模型，但清空详细字段
    article_schemas = []
    for article in articles:
        article_data = ArticleSchema.model_validate(article)
        # 清空所有详细字段
        update_data = {
            'content': None,
            'summary': None,
            'author': None,
            'tags': None,
            'user_notes': None,
            'target_audience': None,
        }
        article_data = article_data.model_copy(update=update_data)
        article_schemas.append(article_data)
    
    return article_schemas


@router.get("/{article_id}/fields")
async def get_article_fields(
    article_id: int,
    fields: str = Query(..., description="要获取的字段，逗号分隔，如：summary,content,tags,author,user_notes"),
    db: Session = Depends(get_database),
):
    """获取文章的特定字段（用于按需加载）
    
    支持的字段：
    - summary: AI总结
    - content: 文章内容
    - author: 作者
    - tags: 标签列表
    - user_notes: 用户笔记
    - target_audience: 目标受众
    
    返回格式：{"summary": "...", "content": "...", "tags": [...], ...}
    
    特殊值 "all" 可以获取所有详细字段。
    """
    article = _get_article_or_404(db, article_id)
    
    # 如果请求所有字段
    if fields.strip().lower() == "all":
        return {
            "summary": article.summary,
            "content": article.content,
            "author": article.author,
            "tags": article.tags,
            "user_notes": article.user_notes,
            "target_audience": article.target_audience,
        }
    
    requested_fields = [f.strip() for f in fields.split(",")]
    result = {}
    
    # 支持的字段映射
    field_mapping = {
        "summary": lambda: article.summary,
        "content": lambda: article.content,
        "author": lambda: article.author,
        "tags": lambda: article.tags,
        "user_notes": lambda: article.user_notes,
        "target_audience": lambda: article.target_audience,
    }
    
    for field in requested_fields:
        if field in field_mapping:
            result[field] = field_mapping[field]()
        else:
            raise HTTPException(
                status_code=400, 
                detail=f"不支持的字段: {field}。支持的字段：{', '.join(field_mapping.keys())}，或使用 'all' 获取所有字段"
            )
    
    return result


@router.post("/{article_id}/analyze")
async def analyze_article(
    article_id: int,
    force: bool = Query(False, description="是否强制重新分析（即使已分析过）"),
    db: Session = Depends(get_database),
    _current_user: str = Depends(require_auth),
):
    """触发文章AI分析（支持重新分析）
    
    注意：对于邮件类型的文章，不会重新采集内容，直接使用已保存的内容进行AI分析。
    其他类型的文章也不会重新采集，只对已保存的内容重新进行AI分析。
    """
    article = _get_article_or_404(db, article_id)
    
    # 如果已分析且未强制重新分析，返回提示信息
    was_processed = article.is_processed
    if was_processed and not force:
        return {
            "message": "文章已分析，如需重新分析请使用 force=true 参数",
            "article_id": article_id,
            "is_processed": True,
        }
    
    # 检查是否为邮件类型
    is_email = article.category == "email" or article.url.startswith("mailto:")
    
    # 对于邮件类型，确保不重新采集，直接使用已保存的内容
    # 对于其他类型，也使用已保存的内容（不重新采集）
    if is_email:
        logger.info(f"📧 邮件类型文章，使用已保存的内容进行重新分析（不重新采集）")
    
    # 检查内容是否存在
    if not article.content:
        raise HTTPException(
            status_code=400, 
            detail="文章内容为空，无法进行分析。邮件类型文章不会重新采集内容，请确保文章已有内容。"
        )
    
    # 创建AI分析器
    ai_analyzer = create_ai_analyzer()
    if not ai_analyzer:
        raise HTTPException(status_code=400, detail="未配置AI分析器")
    
    try:
        # 获取自定义提示词（如果源配置了）
        custom_prompt = None
        if article.source:
            from backend.app.db.models import RSSSource
            source_obj = db.query(RSSSource).filter(
                RSSSource.name == article.source
            ).first()
            if source_obj and source_obj.analysis_prompt:
                custom_prompt = source_obj.analysis_prompt
        
        # 执行AI分析（使用已保存的内容，不重新采集）
        analysis_result = ai_analyzer.analyze_article(
            title=article.title,
            content=article.content or "",
            url=article.url,
            source=article.source,
            category=article.category,
            custom_prompt=custom_prompt,
        )
        
        # 更新文章分析结果
        _update_article_analysis(article, analysis_result)
        
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
    _current_user: str = Depends(require_auth),
):
    """删除文章"""
    success = ArticleRepository.delete_article(db, article_id)
    if not success:
        raise HTTPException(status_code=404, detail="文章不存在")
    return {"message": "文章已删除", "article_id": article_id}


@router.post("/{article_id}/favorite")
async def favorite_article(
    article_id: int,
    db: Session = Depends(get_database),
    _current_user: str = Depends(require_auth),
):
    """收藏文章"""
    article = _get_article_or_404(db, article_id)
    
    article.is_favorited = True
    article.updated_at = datetime.now()
    db.commit()
    
    return {"message": "文章已收藏", "article_id": article_id, "is_favorited": True}


@router.delete("/{article_id}/favorite")
async def unfavorite_article(
    article_id: int,
    db: Session = Depends(get_database),
    _current_user: str = Depends(require_auth),
):
    """取消收藏文章"""
    article = _get_article_or_404(db, article_id)
    
    article.is_favorited = False
    article.updated_at = datetime.now()
    db.commit()
    
    return {"message": "已取消收藏", "article_id": article_id, "is_favorited": False}


@router.put("/{article_id}", response_model=ArticleSchema)
async def update_article(
    article_id: int,
    article_update: ArticleUpdate,
    db: Session = Depends(get_database),
    _current_user: str = Depends(require_auth),
):
    """更新文章"""
    article = _get_article_or_404(db, article_id)
    
    # 更新字段（只更新提供的字段）
    update_data = article_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(article, field, value)
    
    article.updated_at = datetime.now()
    db.commit()
    db.refresh(article)
    
    return ArticleSchema.model_validate(article)


@router.post("/collect", response_model=ArticleSchema)
async def collect_article_from_url(
    url: str = Query(..., description="要采集的文章URL"),
    db: Session = Depends(get_database),
    _current_user: str = Depends(require_auth),
):
    """从URL手动采集文章，并立即进行AI分析"""
    from backend.app.services.collector.web_collector import WebCollector
    from urllib.parse import urlparse
    
    # 验证URL格式
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            raise HTTPException(status_code=400, detail="无效的URL格式")
    except Exception:
        raise HTTPException(status_code=400, detail="无效的URL格式")
    
    # 检查文章是否已存在
    existing_article = db.query(Article).filter(Article.url == url).first()
    if existing_article:
        raise HTTPException(status_code=409, detail=f"文章已存在 (ID: {existing_article.id})")
    
    # 使用WebCollector采集文章
    collector = WebCollector()
    article_data = collector.fetch_single_article(url)
    
    if not article_data:
        raise HTTPException(status_code=500, detail="采集文章失败，请检查URL是否可访问")
    
    # 获取当前时间作为采集时间
    now = datetime.now()
    
    # 优先使用解析出的发布时间，如果解析不出来则使用当前时间
    published_at = article_data.get("published_at")
    if not published_at:
        published_at = now
    
    # 保存文章到数据库
    try:
        new_article = Article(
            title=article_data.get("title", url),
            url=article_data.get("url", url),
            content=article_data.get("content", ""),
            source=article_data.get("source", "手动采集-web页面"),
            category=article_data.get("category", "手动采集-web页面"),
            author=article_data.get("author"),  # 如果解析不出来就是 None
            published_at=published_at,  # 优先使用解析出的日期，否则使用当前时间
            collected_at=now,
        )
        
        db.add(new_article)
        db.flush()  # 刷新以获取ID，但不提交
        
        # 立即进行AI分析
        ai_analyzer = create_ai_analyzer()
        if ai_analyzer:
            try:
                # 获取自定义提示词（如果源配置了）
                custom_prompt = None
                if new_article.source:
                    from backend.app.db.models import RSSSource
                    source_obj = db.query(RSSSource).filter(
                        RSSSource.name == new_article.source
                    ).first()
                    if source_obj and source_obj.analysis_prompt:
                        custom_prompt = source_obj.analysis_prompt
                
                analysis_result = ai_analyzer.analyze_article(
                    title=new_article.title,
                    content=new_article.content or "",
                    url=new_article.url,
                    custom_prompt=custom_prompt,
                )
                
                # 更新文章分析结果
                _update_article_analysis(new_article, analysis_result)
            except Exception as e:
                # AI分析失败不影响文章保存，只记录错误
                logger.warning(f"⚠️  AI分析失败: {e}")
                new_article.is_processed = False
        else:
            # 如果没有配置AI分析器，标记为未分析
            new_article.is_processed = False
        
        db.commit()
        db.refresh(new_article)
        
        return ArticleSchema.model_validate(new_article)
    except Exception as e:
        db.rollback()
        if "UNIQUE constraint failed" in str(e):
            # 并发情况下可能已存在
            existing = db.query(Article).filter(Article.url == url).first()
            if existing:
                return ArticleSchema.model_validate(existing)
        raise HTTPException(status_code=500, detail=f"保存文章失败: {str(e)}")

