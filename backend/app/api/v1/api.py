"""
API v1 路由聚合
"""
from fastapi import APIRouter

from backend.app.api.v1.endpoints import (
    analytics,
    articles,
    auth,
    cleanup,
    collection,
    rag,
    settings,
    social_media,
    sources,
    statistics,
    summary,
    websocket,
)

api_router = APIRouter()

# 路由配置：[(router, prefix, tags), ...]
_ROUTES = [
    (articles, "/articles", ["articles"]),
    (collection, "/collection", ["collection"]),
    (summary, "/summary", ["summary"]),
    (sources, "/sources", ["sources"]),
    (statistics, "/statistics", ["statistics"]),
    (cleanup, "/cleanup", ["cleanup"]),
    (settings, "/settings", ["settings"]),
    (websocket, "/ws", ["websocket"]),
    (rag, "/rag", ["rag"]),
    (auth, "/auth", ["auth"]),
    (social_media, "/social-media", ["social-media"]),
    (analytics, "/analytics", ["analytics"]),
]

# 注册所有路由
for router_module, prefix, tags in _ROUTES:
    api_router.include_router(
        router_module.router,
        prefix=prefix,
        tags=tags
    )

