"""
Knowledge graph API endpoints.
"""
import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.app.api.v1.endpoints.settings import require_auth
from backend.app.core.dependencies import get_database
from backend.app.db import get_db
from backend.app.schemas.knowledge_graph import (
    KnowledgeGraphArticleContextResponse,
    KnowledgeGraphBuildSummary,
    KnowledgeGraphCommunityDetail,
    KnowledgeGraphCommunityListResponse,
    KnowledgeGraphIntegrityRepairRequest,
    KnowledgeGraphIntegrityRepairResponse,
    KnowledgeGraphIntegrityReport,
    KnowledgeGraphNodeDetail,
    KnowledgeGraphNodeListResponse,
    KnowledgeGraphPathRequest,
    KnowledgeGraphPathResponse,
    KnowledgeGraphQueryRequest,
    KnowledgeGraphQueryResponse,
    KnowledgeGraphSnapshotResponse,
    KnowledgeGraphStatsResponse,
    KnowledgeGraphSyncRequest,
    KnowledgeGraphSyncResponse,
)
from backend.app.services.knowledge_graph import KnowledgeGraphService
from backend.app.utils import create_knowledge_graph_ai_analyzer

logger = logging.getLogger(__name__)

router = APIRouter()


def run_knowledge_graph_sync(request: KnowledgeGraphSyncRequest) -> dict:
    """在线程内部创建数据库会话，避免跨线程复用 FastAPI 请求 Session。"""
    db_manager = get_db()
    with db_manager.get_session() as db:
        service = KnowledgeGraphService(db=db, ai_analyzer=create_knowledge_graph_ai_analyzer())
        return service.sync_articles(
            article_ids=request.article_ids,
            force_rebuild=request.force_rebuild,
            sync_mode=request.sync_mode,
            max_articles=request.max_articles,
            trigger_source=request.trigger_source,
        )


def run_knowledge_graph_integrity_repair(request: KnowledgeGraphIntegrityRepairRequest) -> dict:
    """在线程内部执行耗时修复，避免阻塞 Uvicorn 事件循环。"""
    db_manager = get_db()
    with db_manager.get_session() as db:
        service = KnowledgeGraphService(db=db, ai_analyzer=create_knowledge_graph_ai_analyzer())
        return service.repair_integrity(
            dry_run=request.dry_run,
            cleanup_orphans=request.cleanup_orphans,
            rebuild_snapshot=request.rebuild_snapshot,
            resync_suspects=request.resync_suspects,
            keyword=request.keyword,
            limit=request.limit,
            sync_mode=request.sync_mode,
        )


def get_knowledge_graph_service(
    db: Session = Depends(get_database),
) -> KnowledgeGraphService:
    return KnowledgeGraphService(db=db, ai_analyzer=create_knowledge_graph_ai_analyzer())


@router.get("/stats", response_model=KnowledgeGraphStatsResponse)
async def get_knowledge_graph_stats(
    service: KnowledgeGraphService = Depends(get_knowledge_graph_service),
):
    return KnowledgeGraphStatsResponse(**service.get_stats())


@router.post("/sync", response_model=KnowledgeGraphSyncResponse)
async def sync_knowledge_graph(
    request: KnowledgeGraphSyncRequest,
    current_user: str = Depends(require_auth),
):
    del current_user
    try:
        result = await asyncio.to_thread(run_knowledge_graph_sync, request)
        return KnowledgeGraphSyncResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Knowledge graph sync failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Knowledge graph sync failed: {exc}") from exc


@router.get("/builds", response_model=list[KnowledgeGraphBuildSummary])
async def list_knowledge_graph_builds(
    limit: int = Query(20, ge=1, le=100),
    service: KnowledgeGraphService = Depends(get_knowledge_graph_service),
):
    return [KnowledgeGraphBuildSummary(**item) for item in service.get_builds(limit=limit)]


@router.get("/integrity", response_model=KnowledgeGraphIntegrityReport)
async def diagnose_knowledge_graph_integrity(
    keyword: Optional[str] = Query(None, max_length=100),
    limit: int = Query(100, ge=1, le=500),
    service: KnowledgeGraphService = Depends(get_knowledge_graph_service),
):
    return KnowledgeGraphIntegrityReport(**service.diagnose_integrity(keyword=keyword, limit=limit))


@router.post("/integrity/repair", response_model=KnowledgeGraphIntegrityRepairResponse)
async def repair_knowledge_graph_integrity(
    request: KnowledgeGraphIntegrityRepairRequest,
    current_user: str = Depends(require_auth),
):
    del current_user
    try:
        result = await asyncio.to_thread(run_knowledge_graph_integrity_repair, request)
        return KnowledgeGraphIntegrityRepairResponse(**result)
    except Exception as exc:
        logger.error("Knowledge graph integrity repair failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Knowledge graph integrity repair failed: {exc}") from exc


@router.get("/snapshot", response_model=KnowledgeGraphSnapshotResponse)
async def get_knowledge_graph_snapshot(
    community_id: Optional[int] = Query(None),
    node_type: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit_nodes: int = Query(160, ge=10, le=500),
    focus_node_keys: Optional[list[str]] = Query(None),
    expand_depth: int = Query(0, ge=0, le=2),
    service: KnowledgeGraphService = Depends(get_knowledge_graph_service),
):
    return KnowledgeGraphSnapshotResponse(
        **service.get_snapshot_view(
            community_id=community_id,
            node_type=node_type,
            query=q,
            limit_nodes=limit_nodes,
            focus_node_keys=focus_node_keys,
            expand_depth=expand_depth,
        )
    )


@router.get("/nodes", response_model=KnowledgeGraphNodeListResponse)
async def list_knowledge_graph_nodes(
    q: Optional[str] = Query(None),
    node_type: Optional[str] = Query(None),
    limit: int = Query(25, ge=1, le=200),
    service: KnowledgeGraphService = Depends(get_knowledge_graph_service),
):
    items = service.search_nodes(query=q, node_type=node_type, limit=limit)
    return KnowledgeGraphNodeListResponse(items=items, total=len(items))


@router.get("/nodes/{node_key:path}", response_model=KnowledgeGraphNodeDetail)
async def get_knowledge_graph_node(
    node_key: str,
    service: KnowledgeGraphService = Depends(get_knowledge_graph_service),
):
    try:
        return KnowledgeGraphNodeDetail(**service.get_node_detail(node_key))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/communities", response_model=KnowledgeGraphCommunityListResponse)
async def list_knowledge_graph_communities(
    limit: int = Query(20, ge=1, le=100),
    service: KnowledgeGraphService = Depends(get_knowledge_graph_service),
):
    items = service.get_communities(limit=limit)
    return KnowledgeGraphCommunityListResponse(items=items, total=len(items))


@router.get("/communities/{community_id}", response_model=KnowledgeGraphCommunityDetail)
async def get_knowledge_graph_community(
    community_id: int,
    service: KnowledgeGraphService = Depends(get_knowledge_graph_service),
):
    try:
        return KnowledgeGraphCommunityDetail(**service.get_community_detail(community_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/path", response_model=KnowledgeGraphPathResponse)
async def find_knowledge_graph_path(
    request: KnowledgeGraphPathRequest,
    service: KnowledgeGraphService = Depends(get_knowledge_graph_service),
):
    return KnowledgeGraphPathResponse(
        **service.find_path(
            source_node_key=request.source_node_key,
            target_node_key=request.target_node_key,
        )
    )


@router.post("/query", response_model=KnowledgeGraphQueryResponse)
async def query_knowledge_graph(
    request: KnowledgeGraphQueryRequest,
    service: KnowledgeGraphService = Depends(get_knowledge_graph_service),
):
    try:
        result = await asyncio.to_thread(
            service.answer_question,
            request.question,
            mode=request.mode,
            top_k=request.top_k,
            query_depth=request.query_depth,
            conversation_history=request.conversation_history,
        )
        return KnowledgeGraphQueryResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Knowledge graph query failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Knowledge graph query failed: {exc}") from exc


@router.post("/query/stream")
async def stream_knowledge_graph_query(
    request: KnowledgeGraphQueryRequest,
    service: KnowledgeGraphService = Depends(get_knowledge_graph_service),
):
    async def generate_stream():
        try:
            loop = asyncio.get_event_loop()
            generator = await loop.run_in_executor(
                None,
                lambda: service.stream_answer(
                    request.question,
                    mode=request.mode,
                    top_k=request.top_k,
                    query_depth=request.query_depth,
                    conversation_history=request.conversation_history,
                ),
            )

            def next_chunk(gen):
                try:
                    return next(gen)
                except StopIteration:
                    raise

            while True:
                try:
                    chunk = await loop.run_in_executor(None, next_chunk, generator)
                except StopIteration:
                    break
                yield f"data: {json.dumps(jsonable_encoder(chunk), ensure_ascii=False)}\n\n"
                if chunk.get("type") in {"done", "error"}:
                    break
        except ValueError as exc:
            yield f"data: {json.dumps({'type': 'error', 'data': {'message': str(exc)}}, ensure_ascii=False)}\n\n"
        except Exception as exc:
            logger.error("Knowledge graph streaming query failed: %s", exc, exc_info=True)
            yield (
                "data: "
                + json.dumps(
                    {"type": "error", "data": {"message": f"Knowledge graph streaming failed: {exc}"}},
                    ensure_ascii=False,
                )
                + "\n\n"
            )

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/articles/{article_id}/context", response_model=KnowledgeGraphArticleContextResponse)
async def get_article_graph_context(
    article_id: int,
    service: KnowledgeGraphService = Depends(get_knowledge_graph_service),
):
    return KnowledgeGraphArticleContextResponse(**service.get_article_context(article_id))
