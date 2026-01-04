"""
RAG相关 API 端点
"""
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy.orm import Session
from backend.app.core.paths import setup_python_path

logger = logging.getLogger(__name__)

# 确保项目根目录在 Python 路径中
setup_python_path()

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
            detail="未配置AI分析器，请在系统功能中配置LLM API密钥"
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
        import json
        processed_results = []
        for result in results:
            # 确保 topics 和 tags 是列表格式
            if "topics" in result:
                if isinstance(result["topics"], str):
                    try:
                        result["topics"] = json.loads(result["topics"])
                    except (json.JSONDecodeError, TypeError):
                        logger.warning(f"无法解析 topics JSON: {result['topics']}")
                        result["topics"] = []
                elif not isinstance(result["topics"], list):
                    result["topics"] = result["topics"] if result["topics"] else []
            
            if "tags" in result:
                if isinstance(result["tags"], str):
                    try:
                        result["tags"] = json.loads(result["tags"])
                    except (json.JSONDecodeError, TypeError):
                        logger.warning(f"无法解析 tags JSON: {result['tags']}")
                        result["tags"] = []
                elif not isinstance(result["tags"], list):
                    result["tags"] = result["tags"] if result["tags"] else []
            
            processed_results.append(ArticleSearchResult(**result))
        
        search_results = processed_results
        
        return RAGSearchResponse(
            query=request.query,
            results=search_results,
            total=len(search_results)
        )
    except Exception as e:
        logger.error(f"搜索失败: {e}", exc_info=True)
        import traceback
        logger.error(f"完整堆栈跟踪:\n{traceback.format_exc()}")
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
        logger.info(f"收到问答请求: question={request.question[:100]}, top_k={request.top_k}")
        result = rag_service.query_articles(
            question=request.question,
            top_k=request.top_k
        )
        
        logger.info(f"问答服务返回结果: answer长度={len(result.get('answer', ''))}, articles数量={len(result.get('articles', []))}")
        
        # 转换文章格式
        try:
            import json
            processed_articles = []
            for article in result["articles"]:
                # 确保 topics 和 tags 是列表格式
                if "topics" in article:
                    if isinstance(article["topics"], str):
                        try:
                            article["topics"] = json.loads(article["topics"])
                        except (json.JSONDecodeError, TypeError):
                            logger.warning(f"无法解析 topics JSON: {article['topics']}")
                            article["topics"] = []
                    elif not isinstance(article["topics"], list):
                        article["topics"] = article["topics"] if article["topics"] else []
                
                if "tags" in article:
                    if isinstance(article["tags"], str):
                        try:
                            article["tags"] = json.loads(article["tags"])
                        except (json.JSONDecodeError, TypeError):
                            logger.warning(f"无法解析 tags JSON: {article['tags']}")
                            article["tags"] = []
                    elif not isinstance(article["tags"], list):
                        article["tags"] = article["tags"] if article["tags"] else []
                
                processed_articles.append(ArticleSearchResult(**article))
            
            articles = processed_articles
            logger.info(f"成功转换 {len(articles)} 篇文章格式")
        except Exception as e:
            logger.error(f"转换文章格式失败: {e}", exc_info=True)
            logger.error(f"原始文章数据: {result.get('articles', [])}")
            raise HTTPException(status_code=500, detail=f"转换文章格式失败: {str(e)}")
        
        return RAGQueryResponse(
            question=request.question,
            answer=result["answer"],
            sources=result["sources"],
            articles=articles
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"问答失败: {e}", exc_info=True)
        logger.error(f"请求参数: question={request.question}, top_k={request.top_k}")
        import traceback
        logger.error(f"完整堆栈跟踪:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"问答失败: {str(e)}")


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
    batch_size: int = Query(10, ge=1, le=100, description="批处理大小"),
    rag_service: RAGService = Depends(get_rag_service),
    db: Session = Depends(get_database),
):
    """
    索引所有未索引的文章

    Args:
        batch_size: 批处理大小（查询参数）
        rag_service: RAG服务实例
        db: 数据库会话

    Returns:
        批量索引结果
    """
    try:
        logger.info(f"收到索引所有文章的请求: batch_size={batch_size}")
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
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"参数验证失败: {e}", exc_info=True)
        raise HTTPException(status_code=422, detail=f"参数验证失败: {str(e)}")
    except Exception as e:
        logger.error(f"批量索引失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"批量索引失败: {str(e)}")


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

