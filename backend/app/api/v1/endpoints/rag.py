"""
RAG相关 API 端点
"""
import sys
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.app.db.models import Article, ArticleEmbedding
from backend.app.core.dependencies import get_database
from backend.app.services.rag.rag_service import RAGService
from backend.app.utils import create_ai_analyzer
from backend.app.schemas.rag import (
    RAGSearchRequest,
    RAGSearchResponse,
    RAGQueryRequest,
    RAGQueryResponse,
    RAGIndexResponse,
    RAGBatchIndexRequest,
    RAGBatchIndexResponse,
    RAGStatsResponse,
    ArticleSearchResult,
)

router = APIRouter()


def get_rag_service(
    db: Session = Depends(get_database),
) -> RAGService:
    """
    获取RAG服务实例

    Args:
        db: 数据库会话

    Returns:
        RAG服务实例
    """
    ai_analyzer = create_ai_analyzer()
    if not ai_analyzer:
        raise HTTPException(
            status_code=400,
            detail="未配置AI分析器，请检查OPENAI_API_KEY环境变量"
        )
    return RAGService(ai_analyzer=ai_analyzer, db=db)


@router.post("/search", response_model=RAGSearchResponse)
async def search_articles(
    request: RAGSearchRequest,
    rag_service: RAGService = Depends(get_rag_service),
):
    """
    语义搜索文章

    Args:
        request: 搜索请求
        rag_service: RAG服务实例

    Returns:
        搜索结果
    """
    try:
        # 构建过滤条件
        filters = {}
        if request.sources:
            filters["sources"] = request.sources
        if request.importance:
            filters["importance"] = request.importance
        if request.time_from:
            filters["time_from"] = request.time_from
        if request.time_to:
            filters["time_to"] = request.time_to
        
        # 执行搜索
        results = rag_service.search_articles(
            query=request.query,
            top_k=request.top_k,
            filters=filters if filters else None
        )
        
        # 转换为响应格式
        search_results = [
            ArticleSearchResult(**result) for result in results
        ]
        
        return RAGSearchResponse(
            query=request.query,
            results=search_results,
            total=len(search_results)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"搜索失败: {str(e)}")


@router.post("/query", response_model=RAGQueryResponse)
async def query_articles(
    request: RAGQueryRequest,
    rag_service: RAGService = Depends(get_rag_service),
):
    """
    智能问答：基于文章内容回答问题

    Args:
        request: 问答请求
        rag_service: RAG服务实例

    Returns:
        问答结果
    """
    try:
        result = rag_service.query_articles(
            question=request.question,
            top_k=request.top_k
        )
        
        # 转换文章格式
        articles = [
            ArticleSearchResult(**article) for article in result["articles"]
        ]
        
        return RAGQueryResponse(
            question=request.question,
            answer=result["answer"],
            sources=result["sources"],
            articles=articles
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"问答失败: {str(e)}")


@router.post("/index/{article_id}", response_model=RAGIndexResponse)
async def index_article(
    article_id: int,
    rag_service: RAGService = Depends(get_rag_service),
    db: Session = Depends(get_database),
):
    """
    索引单篇文章

    Args:
        article_id: 文章ID
        rag_service: RAG服务实例
        db: 数据库会话

    Returns:
        索引结果
    """
    try:
        # 获取文章
        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            raise HTTPException(status_code=404, detail="文章不存在")
        
        # 执行索引
        success = rag_service.index_article(article)
        
        if success:
            return RAGIndexResponse(
                success=True,
                article_id=article_id,
                message="文章索引成功"
            )
        else:
            return RAGIndexResponse(
                success=False,
                article_id=article_id,
                message="文章索引失败，可能没有可索引的内容"
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"索引失败: {str(e)}")


@router.post("/index/batch", response_model=RAGBatchIndexResponse)
async def index_articles_batch(
    request: RAGBatchIndexRequest,
    rag_service: RAGService = Depends(get_rag_service),
    db: Session = Depends(get_database),
):
    """
    批量索引文章

    Args:
        request: 批量索引请求
        rag_service: RAG服务实例
        db: 数据库会话

    Returns:
        批量索引结果
    """
    try:
        if request.article_ids:
            # 索引指定的文章
            articles = db.query(Article).filter(
                Article.id.in_(request.article_ids)
            ).all()
        else:
            # 索引所有未索引的文章
            indexed_ids = db.query(ArticleEmbedding.article_id).subquery()
            articles = db.query(Article).filter(
                ~Article.id.in_(indexed_ids)
            ).all()
        
        if not articles:
            return RAGBatchIndexResponse(
                total=0,
                success=0,
                failed=0,
                message="没有需要索引的文章"
            )
        
        # 执行批量索引
        result = rag_service.index_articles_batch(
            articles=articles,
            batch_size=request.batch_size
        )
        
        return RAGBatchIndexResponse(
            total=result["total"],
            success=result["success"],
            failed=result["failed"],
            message=f"批量索引完成: 总计 {result['total']}, 成功 {result['success']}, 失败 {result['failed']}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"批量索引失败: {str(e)}")


@router.post("/index/all", response_model=RAGBatchIndexResponse)
async def index_all_articles(
    batch_size: int = 10,
    rag_service: RAGService = Depends(get_rag_service),
    db: Session = Depends(get_database),
):
    """
    索引所有未索引的文章

    Args:
        batch_size: 批处理大小
        rag_service: RAG服务实例
        db: 数据库会话

    Returns:
        批量索引结果
    """
    try:
        # 获取所有未索引的文章
        indexed_ids = db.query(ArticleEmbedding.article_id).subquery()
        articles = db.query(Article).filter(
            ~Article.id.in_(indexed_ids)
        ).all()
        
        if not articles:
            return RAGBatchIndexResponse(
                total=0,
                success=0,
                failed=0,
                message="所有文章已索引"
            )
        
        # 执行批量索引
        result = rag_service.index_articles_batch(
            articles=articles,
            batch_size=batch_size
        )
        
        return RAGBatchIndexResponse(
            total=result["total"],
            success=result["success"],
            failed=result["failed"],
            message=f"批量索引完成: 总计 {result['total']}, 成功 {result['success']}, 失败 {result['failed']}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"批量索引失败: {str(e)}")


@router.get("/stats", response_model=RAGStatsResponse)
async def get_rag_stats(
    rag_service: RAGService = Depends(get_rag_service),
):
    """
    获取RAG索引统计信息

    Args:
        rag_service: RAG服务实例

    Returns:
        统计信息
    """
    try:
        stats = rag_service.get_index_stats()
        return RAGStatsResponse(**stats)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取统计信息失败: {str(e)}")

