"""
Knowledge graph related Pydantic models.
"""
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


GraphConfidence = Literal["EXTRACTED", "INFERRED", "AMBIGUOUS"]
KnowledgeGraphRunMode = Literal["auto", "agent", "deterministic"]
KnowledgeGraphQueryMode = Literal["auto", "graph", "hybrid", "rag"]
BuildStatus = Literal["pending", "running", "completed", "failed"]


class KnowledgeGraphSettings(BaseModel):
    """Knowledge graph settings payload."""

    enabled: bool = Field(default=True, description="Whether the knowledge graph is enabled")
    auto_sync_enabled: bool = Field(
        default=True,
        description="Whether article collection should trigger graph sync automatically",
    )
    run_mode: KnowledgeGraphRunMode = Field(
        default="auto",
        description="Execution mode for graph extraction",
    )
    max_articles_per_sync: int = Field(
        default=100,
        ge=1,
        le=1000,
        description="Maximum number of articles to process in one sync run",
    )
    query_depth: int = Field(
        default=2,
        ge=1,
        le=6,
        description="Default BFS expansion depth for graph queries",
    )


class KnowledgeGraphSyncRequest(BaseModel):
    """Sync request."""

    article_ids: Optional[List[int]] = Field(
        default=None,
        description="Optional explicit article ids to sync",
    )
    force_rebuild: bool = Field(
        default=False,
        description="Whether to rebuild the entire graph from scratch",
    )
    sync_mode: Optional[KnowledgeGraphRunMode] = Field(
        default=None,
        description="Optional override for the sync mode",
    )
    max_articles: Optional[int] = Field(
        default=None,
        ge=1,
        le=1000,
        description="Optional cap for number of articles processed",
    )
    trigger_source: str = Field(
        default="manual",
        max_length=50,
        description="Logical source for the sync trigger",
    )


class KnowledgeGraphBuildSummary(BaseModel):
    """Build execution summary."""

    build_id: str
    status: BuildStatus
    trigger_source: str
    sync_mode: str
    total_articles: int
    processed_articles: int
    skipped_articles: int = 0
    failed_articles: int = 0
    nodes_upserted: int
    edges_upserted: int
    error_message: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
    extra_data: Optional[Dict[str, Any]] = None


class KnowledgeGraphSyncResponse(BaseModel):
    """Sync response."""

    build: KnowledgeGraphBuildSummary
    stats: Optional["KnowledgeGraphStatsResponse"] = None


class KnowledgeGraphEdgeSummary(BaseModel):
    """Edge payload used by detail endpoints."""

    source_node_key: str
    target_node_key: str
    relation_type: str
    confidence: GraphConfidence
    confidence_score: float
    weight: float
    source_article_id: Optional[int] = None
    evidence_snippet: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class KnowledgeGraphArticleReference(BaseModel):
    """Article reference attached to graph responses."""

    id: int
    title: str
    title_zh: Optional[str] = None
    url: str
    source: str
    published_at: Optional[datetime] = None
    summary: Optional[str] = None
    detailed_summary: Optional[str] = None
    importance: Optional[str] = None
    tags: Optional[List[str]] = None
    relation_count: int = 0
    distance: Optional[int] = None


class KnowledgeGraphNodeSummary(BaseModel):
    """Node summary."""

    node_key: str
    label: str
    node_type: str
    aliases: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    degree: int = 0
    article_count: int = 0
    community_id: Optional[int] = None
    centrality: float = 0.0


class KnowledgeGraphNodeListResponse(BaseModel):
    """Node list response."""

    items: List[KnowledgeGraphNodeSummary]
    total: int


class KnowledgeGraphNodeDetail(BaseModel):
    """Node detail response."""

    node: KnowledgeGraphNodeSummary
    neighbors: List[KnowledgeGraphNodeSummary]
    edges: List[KnowledgeGraphEdgeSummary]
    related_articles: List[KnowledgeGraphArticleReference]
    matched_communities: List["KnowledgeGraphCommunitySummary"] = Field(default_factory=list)


class KnowledgeGraphCommunitySummary(BaseModel):
    """Community summary."""

    community_id: int
    label: str
    node_count: int
    edge_count: int
    article_count: int
    top_nodes: List[KnowledgeGraphNodeSummary] = Field(default_factory=list)


class KnowledgeGraphCommunityListResponse(BaseModel):
    """Community list response."""

    items: List[KnowledgeGraphCommunitySummary]
    total: int


class KnowledgeGraphCommunityDetail(BaseModel):
    """Community detail response."""

    community: KnowledgeGraphCommunitySummary
    nodes: List[KnowledgeGraphNodeSummary]
    articles: List[KnowledgeGraphArticleReference]
    summary_text: str = ""
    relation_types: List[str] = Field(default_factory=list)


class KnowledgeGraphLinkSummary(BaseModel):
    """Lightweight graph link used by the visualization snapshot."""

    source: str
    target: str
    weight: float
    relation_types: List[str] = Field(default_factory=list)
    article_count: int = 0


class KnowledgeGraphSnapshotResponse(BaseModel):
    """Filtered snapshot payload for graph visualization."""

    generated_at: Optional[datetime] = None
    build: Optional[KnowledgeGraphBuildSummary] = None
    nodes: List[KnowledgeGraphNodeSummary] = Field(default_factory=list)
    links: List[KnowledgeGraphLinkSummary] = Field(default_factory=list)
    communities: List[KnowledgeGraphCommunitySummary] = Field(default_factory=list)
    total_nodes: int = 0
    total_links: int = 0
    available_node_types: List[str] = Field(default_factory=list)


class KnowledgeGraphPathRequest(BaseModel):
    """Path request."""

    source_node_key: str = Field(..., description="Start node key")
    target_node_key: str = Field(..., description="End node key")


class KnowledgeGraphPathResponse(BaseModel):
    """Path response."""

    found: bool
    source_node_key: str
    target_node_key: str
    distance: Optional[int] = None
    nodes: List[KnowledgeGraphNodeSummary] = Field(default_factory=list)
    edges: List[KnowledgeGraphEdgeSummary] = Field(default_factory=list)
    message: Optional[str] = None


class KnowledgeGraphArticleContextResponse(BaseModel):
    """Article graph context."""

    article_id: int
    article: Optional[KnowledgeGraphArticleReference] = None
    nodes: List[KnowledgeGraphNodeSummary] = Field(default_factory=list)
    edges: List[KnowledgeGraphEdgeSummary] = Field(default_factory=list)
    communities: List[KnowledgeGraphCommunitySummary] = Field(default_factory=list)
    related_articles: List[KnowledgeGraphArticleReference] = Field(default_factory=list)


class KnowledgeGraphQueryRequest(BaseModel):
    """Graph/hybrid query request."""

    question: str = Field(..., description="Question text")
    mode: KnowledgeGraphQueryMode = Field(
        default="graph",
        description="Query mode for answering the question",
    )
    top_k: int = Field(
        default=5,
        ge=1,
        le=10,
        description="Maximum number of related articles to return",
    )
    query_depth: Optional[int] = Field(
        default=None,
        ge=1,
        le=6,
        description="Optional override for graph traversal depth",
    )
    conversation_history: Optional[List[Dict[str, str]]] = Field(
        default=None,
        description="Optional conversation history",
    )


class KnowledgeGraphQueryResponse(BaseModel):
    """Graph/hybrid query response."""

    question: str
    mode: KnowledgeGraphQueryMode
    resolved_mode: KnowledgeGraphQueryMode
    answer: str
    matched_nodes: List[KnowledgeGraphNodeSummary] = Field(default_factory=list)
    matched_communities: List[KnowledgeGraphCommunitySummary] = Field(default_factory=list)
    related_articles: List[KnowledgeGraphArticleReference] = Field(default_factory=list)
    context_node_count: int = 0
    context_edge_count: int = 0


class KnowledgeGraphStatsResponse(BaseModel):
    """Graph statistics response."""

    enabled: bool = True
    total_nodes: int = 0
    total_edges: int = 0
    total_article_nodes: int = 0
    total_articles: int = 0
    synced_articles: int = 0
    failed_articles: int = 0
    coverage: float = 0.0
    snapshot_updated_at: Optional[datetime] = None
    node_type_counts: Dict[str, int] = Field(default_factory=dict)
    relation_type_counts: Dict[str, int] = Field(default_factory=dict)
    top_nodes: List[KnowledgeGraphNodeSummary] = Field(default_factory=list)
    top_communities: List[KnowledgeGraphCommunitySummary] = Field(default_factory=list)
    last_build: Optional[KnowledgeGraphBuildSummary] = None


KnowledgeGraphSyncResponse.model_rebuild()
KnowledgeGraphNodeDetail.model_rebuild()
KnowledgeGraphArticleContextResponse.model_rebuild()
