"""
Industry graph API endpoints.
"""
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.app.api.v1.endpoints.settings import require_auth
from backend.app.core.dependencies import get_database
from backend.app.schemas.industry_graph import (
    IndustryGraphConversation,
    IndustryGraphConversationCreateRequest,
    IndustryGraphConversationListResponse,
    IndustryGraphConversationRenameRequest,
    IndustryGraphProcessRequest,
    IndustryGraphProcessResponse,
    IndustryGraphQueryRequest,
    IndustryGraphQueryResponse,
    IndustryGraphRebuildRequest,
    IndustryGraphRebuildResponse,
    IndustryGraphStatsResponse,
    IndustryGraphSuggestedQuestionListResponse,
    IndustryGraphTrend,
)
from backend.app.services.industry_graph import IndustryGraphService
from backend.app.utils import create_ai_analyzer

logger = logging.getLogger(__name__)

router = APIRouter()


def get_industry_graph_service(
    db: Session = Depends(get_database),
) -> IndustryGraphService:
    return IndustryGraphService(db=db, ai_analyzer=create_ai_analyzer())


@router.get("/stats", response_model=IndustryGraphStatsResponse)
async def get_industry_graph_stats(
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    return IndustryGraphStatsResponse(**service.get_stats())


@router.post("/documents/import-articles")
async def import_articles_to_industry_graph(
    limit: Optional[int] = Query(None, ge=1, le=5000),
    current_user: str = Depends(require_auth),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    del current_user
    return service.import_articles(limit=limit)


@router.post("/documents/process-articles", response_model=IndustryGraphProcessResponse)
async def process_articles_for_industry_graph(
    request: IndustryGraphProcessRequest,
    current_user: str = Depends(require_auth),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    del current_user
    try:
        return IndustryGraphProcessResponse(
            **service.process_articles(
                limit=request.limit,
                article_ids=request.article_ids,
                force=request.force,
                import_first=request.import_first,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Industry graph article processing failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Industry graph article processing failed: {exc}") from exc


@router.post("/documents/rebuild", response_model=IndustryGraphRebuildResponse)
async def rebuild_industry_graph_documents(
    request: IndustryGraphRebuildRequest,
    current_user: str = Depends(require_auth),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    del current_user
    try:
        return IndustryGraphRebuildResponse(
            **service.rebuild_all_articles(
                batch_size=request.batch_size,
                max_documents=request.max_documents,
                clear_existing_graph=request.clear_existing_graph,
            )
        )
    except Exception as exc:
        logger.error("Industry graph rebuild failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Industry graph rebuild failed: {exc}") from exc


@router.get("/suggested-questions", response_model=IndustryGraphSuggestedQuestionListResponse)
async def get_suggested_questions(
    limit: int = Query(6, ge=1, le=20),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    return IndustryGraphSuggestedQuestionListResponse(
        items=service.get_suggested_questions(limit=limit)
    )


@router.post("/suggested-questions/generate", response_model=IndustryGraphSuggestedQuestionListResponse)
async def generate_suggested_questions(
    limit: int = Query(6, ge=1, le=20),
    current_user: str = Depends(require_auth),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    del current_user
    return IndustryGraphSuggestedQuestionListResponse(
        items=service.generate_suggested_questions(limit=limit)
    )


@router.get("/trends", response_model=list[IndustryGraphTrend])
async def get_technology_trends(
    limit: int = Query(10, ge=1, le=50),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    return [IndustryGraphTrend(**item) for item in service.get_technology_trends(limit=limit)]


@router.get("/conversations", response_model=IndustryGraphConversationListResponse)
async def list_conversations(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: str = Depends(require_auth),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    return IndustryGraphConversationListResponse(
        items=service.list_conversations(limit=limit, offset=offset, user_id=current_user)
    )


@router.post("/conversations", response_model=IndustryGraphConversation)
async def create_conversation(
    request: IndustryGraphConversationCreateRequest,
    current_user: str = Depends(require_auth),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    return IndustryGraphConversation(
        **service.create_conversation(
            title=request.title,
            primary_scenario=request.primary_scenario,
            user_id=current_user,
        )
    )


@router.get("/conversations/{conversation_id}", response_model=IndustryGraphConversation)
async def get_conversation(
    conversation_id: int,
    current_user: str = Depends(require_auth),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    try:
        return IndustryGraphConversation(**service.get_conversation(conversation_id, user_id=current_user))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/conversations/{conversation_id}", response_model=IndustryGraphConversation)
async def rename_conversation(
    conversation_id: int,
    request: IndustryGraphConversationRenameRequest,
    current_user: str = Depends(require_auth),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    try:
        return IndustryGraphConversation(
            **service.rename_conversation(conversation_id, title=request.title, user_id=current_user)
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: int,
    current_user: str = Depends(require_auth),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    try:
        return service.delete_conversation(conversation_id, user_id=current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/query", response_model=IndustryGraphQueryResponse)
async def query_industry_graph(
    request: IndustryGraphQueryRequest,
    current_user: str = Depends(require_auth),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    try:
        return IndustryGraphQueryResponse(
            **service.answer_question(
                request.question,
                conversation_id=request.conversation_id,
                scenario=request.scenario,
                time_range=jsonable_encoder(request.time_range) if request.time_range else None,
                top_k=request.top_k,
                user_id=current_user,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Industry graph query failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Industry graph query failed: {exc}") from exc


@router.post("/query/stream")
async def stream_industry_graph_query(
    request: IndustryGraphQueryRequest,
    current_user: str = Depends(require_auth),
    service: IndustryGraphService = Depends(get_industry_graph_service),
):
    def generate_stream():
        try:
            for chunk in service.stream_answer(
                request.question,
                conversation_id=request.conversation_id,
                scenario=request.scenario,
                time_range=jsonable_encoder(request.time_range) if request.time_range else None,
                top_k=request.top_k,
                user_id=current_user,
            ):
                yield f"data: {json.dumps(jsonable_encoder(chunk), ensure_ascii=False)}\n\n"
                if chunk.get("type") in {"done", "error"}:
                    break
        except ValueError as exc:
            yield f"data: {json.dumps({'type': 'error', 'data': {'message': str(exc)}}, ensure_ascii=False)}\n\n"
        except Exception as exc:
            logger.error("Industry graph streaming query failed: %s", exc, exc_info=True)
            payload = {"type": "error", "data": {"message": f"Industry graph streaming failed: {exc}"}}
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
