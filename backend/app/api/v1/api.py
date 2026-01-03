"""
API v1 路由聚合
"""
from fastapi import APIRouter
from backend.app.api.v1.endpoints import (
    articles,
    collection,
    summary,
    sources,
    statistics,
    cleanup,
    settings,
    websocket,
    rag,
)

api_router = APIRouter()

# 注册各个端点
api_router.include_router(articles.router, prefix="/articles", tags=["articles"])
api_router.include_router(collection.router, prefix="/collection", tags=["collection"])
api_router.include_router(summary.router, prefix="/summary", tags=["summary"])
api_router.include_router(sources.router, prefix="/sources", tags=["sources"])
api_router.include_router(statistics.router, prefix="/statistics", tags=["statistics"])
api_router.include_router(cleanup.router, prefix="/cleanup", tags=["cleanup"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
api_router.include_router(websocket.router, prefix="/ws", tags=["websocket"])
api_router.include_router(rag.router, prefix="/rag", tags=["rag"])

