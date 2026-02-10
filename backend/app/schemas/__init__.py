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
from backend.app.schemas.settings import CollectionSettings, AutoCollectionSettings
from backend.app.schemas.exploration import (
    ExplorationTaskCreate,
    ExplorationTaskStartResponse,
    ExplorationTaskResponse,
    ExplorationTaskListResponse,
    ExplorationTaskProgress,
    DiscoveredModelResponse,
    DiscoveredModelListResponse,
    ExplorationModelDetailResponse,
    ExplorationReportSummaryResponse,
    ExplorationReportResponse,
    ExplorationReportListResponse,
    ExplorationModelMarkRequest,
    ExplorationStatisticsResponse,
)

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
    "AutoCollectionSettings",
    "ExplorationTaskCreate",
    "ExplorationTaskStartResponse",
    "ExplorationTaskResponse",
    "ExplorationTaskListResponse",
    "ExplorationTaskProgress",
    "DiscoveredModelResponse",
    "DiscoveredModelListResponse",
    "ExplorationModelDetailResponse",
    "ExplorationReportSummaryResponse",
    "ExplorationReportResponse",
    "ExplorationReportListResponse",
    "ExplorationModelMarkRequest",
    "ExplorationStatisticsResponse",
]



