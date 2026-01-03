"""
Pydantic 模型（API schemas）
"""
from backend.app.schemas.article import Article, ArticleCreate, ArticleUpdate, ArticleFilter
from backend.app.schemas.collection import (
    CollectionTask,
    CollectionTaskCreate,
    CollectionTaskStatus,
    CollectionStats,
)
from backend.app.schemas.summary import (
    DailySummary,
    DailySummaryCreate,
    SummaryGenerateRequest,
)
from backend.app.schemas.source import (
    RSSSource,
    RSSSourceCreate,
    RSSSourceUpdate,
)
from backend.app.schemas.statistics import Statistics
from backend.app.schemas.settings import CollectionSettings

__all__ = [
    "Article",
    "ArticleCreate",
    "ArticleUpdate",
    "ArticleFilter",
    "CollectionTask",
    "CollectionTaskCreate",
    "CollectionTaskStatus",
    "CollectionStats",
    "DailySummary",
    "DailySummaryCreate",
    "SummaryGenerateRequest",
    "RSSSource",
    "RSSSourceCreate",
    "RSSSourceUpdate",
    "Statistics",
    "CollectionSettings",
]



