"""
RAG相关 API 端点
"""
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.app.api.v1.endpoints.settings import require_auth
from backend.app.core.dependencies import get_database
from backend.app.db.models import Article, ArticleEmbedding
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

logger = logging.getLogger(__name__)

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
            # 确保 tags 是列表格式
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
        request: 问答请求（包含对话历史）
        rag_service: RAG服务实例

    Returns:
        问答结果
    """
    try:
        logger.info(f"收到问答请求: question={request.question[:100]}, top_k={request.top_k}")
        
        # 转换对话历史格式
        conversation_history = None
        if request.conversation_history:
            conversation_history = [
                {"role": msg.role, "content": msg.content}
                for msg in request.conversation_history
            ]
            logger.debug(f"包含对话历史: {len(conversation_history)} 条消息")
        
        result = rag_service.query_articles(
            question=request.question,
            top_k=request.top_k,
            conversation_history=conversation_history
        )
        
        logger.info(f"问答服务返回结果: answer长度={len(result.get('answer', ''))}, articles数量={len(result.get('articles', []))}")
        
        # 转换文章格式
        try:
            import json
            processed_articles = []
            for article in result["articles"]:
                # 确保 tags 是列表格式
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


@router.post("/query/stream")
async def query_articles_stream(
    request: RAGQueryRequest,
    rag_service: RAGService = Depends(get_rag_service),
):
    """
    智能问答（流式）：基于文章内容回答问题，支持流式输出

    Args:
        request: 问答请求（包含对话历史）
        rag_service: RAG服务实例

    Returns:
        流式响应（Server-Sent Events格式）
    """
    async def generate_stream():
        try:
            logger.info(f"收到流式问答请求: question={request.question[:100]}, top_k={request.top_k}")
            
            # 转换对话历史格式
            conversation_history = None
            if request.conversation_history:
                conversation_history = [
                    {"role": msg.role, "content": msg.content}
                    for msg in request.conversation_history
                ]
                logger.debug(f"包含对话历史: {len(conversation_history)} 条消息")
            
            # 处理文章格式转换
            def process_article(article):
                processed = article.copy()
                if "tags" in processed:
                    if isinstance(processed["tags"], str):
                        try:
                            processed["tags"] = json.loads(processed["tags"])
                        except (json.JSONDecodeError, TypeError):
                            logger.warning(f"无法解析 tags JSON: {processed['tags']}")
                            processed["tags"] = []
                    elif not isinstance(processed["tags"], list):
                        processed["tags"] = processed["tags"] if processed["tags"] else []
                
                return processed
            
            # 转换对话历史格式
            conversation_history = None
            if request.conversation_history:
                conversation_history = [
                    {"role": msg.role, "content": msg.content}
                    for msg in request.conversation_history
                ]
                logger.debug(f"包含对话历史: {len(conversation_history)} 条消息")
            
            # 调用流式查询
            for chunk in rag_service.query_articles_stream(
                question=request.question,
                top_k=request.top_k,
                conversation_history=conversation_history
            ):
                chunk_type = chunk.get("type")
                chunk_data = chunk.get("data", {})
                
                # 处理文章数据
                if chunk_type == "articles" and "articles" in chunk_data:
                    processed_articles = [process_article(article) for article in chunk_data["articles"]]
                    chunk_data["articles"] = processed_articles
                
                # 发送SSE格式的数据
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            
        except Exception as e:
            logger.error(f"流式问答失败: {e}", exc_info=True)
            error_chunk = {
                "type": "error",
                "data": {"message": f"流式问答失败: {str(e)}"}
            }
            yield f"data: {json.dumps(error_chunk, ensure_ascii=False)}\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用Nginx缓冲
        }
    )


@router.post("/index/batch", response_model=RAGBatchIndexResponse)
async def index_articles_batch(
    request: RAGBatchIndexRequest,
    rag_service: RAGService = Depends(get_rag_service),
    db: Session = Depends(get_database),
    current_user: str = Depends(require_auth),
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


@router.post("/index/clear", response_model=dict)
async def clear_all_indexes(
    db: Session = Depends(get_database),
    current_user: str = Depends(require_auth),
):
    """
    清空所有索引（article_embeddings 和 vec_embeddings）

    Args:
        db: 数据库会话

    Returns:
        清空结果
    """
    try:
        from sqlalchemy import text
        
        # 清空 article_embeddings 表
        deleted_count = db.query(ArticleEmbedding).delete()
        
        # 清空 vec_embeddings 表（如果存在）
        try:
            db.execute(text("DELETE FROM vec_embeddings"))
        except Exception:
            # vec_embeddings 表可能不存在，忽略错误
            pass
        
        db.commit()
        
        logger.info(f"已清空所有索引，删除了 {deleted_count} 条记录")
        
        return {
            "success": True,
            "deleted_count": deleted_count,
            "message": f"已清空所有索引，删除了 {deleted_count} 条记录"
        }
    except Exception as e:
        db.rollback()
        logger.error(f"清空索引失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"清空索引失败: {str(e)}")


@router.post("/index/rebuild", response_model=RAGBatchIndexResponse)
async def rebuild_all_indexes(
    batch_size: int = Query(10, ge=1, le=100, description="批处理大小"),
    rag_service: RAGService = Depends(get_rag_service),
    db: Session = Depends(get_database),
    current_user: str = Depends(require_auth),
):
    """
    强制重建所有索引：先清空所有索引，然后重新索引所有文章

    Args:
        batch_size: 批处理大小
        rag_service: RAG服务实例
        db: 数据库会话

    Returns:
        批量索引结果
    """
    try:
        from sqlalchemy import text
        
        logger.info(f"收到强制重建索引请求: batch_size={batch_size}")
        
        # 第一步：清空所有索引
        deleted_count = db.query(ArticleEmbedding).delete()
        try:
            db.execute(text("DELETE FROM vec_embeddings"))
        except Exception:
            pass
        db.commit()
        
        logger.info(f"已清空所有索引，删除了 {deleted_count} 条记录")
        
        # 第二步：获取所有文章并重新索引
        articles = db.query(Article).all()
        
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
            batch_size=batch_size
        )
        
        return RAGBatchIndexResponse(
            total=result["total"],
            success=result["success"],
            failed=result["failed"],
            message=f"强制重建索引完成: 清空 {deleted_count} 条记录，重新索引总计 {result['total']}, 成功 {result['success']}, 失败 {result['failed']}"
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"强制重建索引失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"强制重建索引失败: {str(e)}")


@router.post("/index/{article_id}", response_model=RAGIndexResponse)
async def index_article(
    article_id: int,
    rag_service: RAGService = Depends(get_rag_service),
    current_user: str = Depends(require_auth),
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

