"""
Industry graph API schemas.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


IndustryScenarioKey = Literal["auto", "technology_evolution"]
IndustryGraphStreamType = Literal[
    "query_plan",
    "text_delta",
    "report_section",
    "trend_card",
    "metric_card",
    "evidence_card",
    "local_graph",
    "entity_card",
    "followup_questions",
    "done",
    "error",
]


class IndustryGraphTimeRange(BaseModel):
    """Relative or explicit time range."""

    preset: Optional[str] = Field(default="last_3_months")
    start: Optional[datetime] = None
    end: Optional[datetime] = None


class IndustryGraphQueryRequest(BaseModel):
    """Chat-style industry graph query."""

    question: str = Field(..., min_length=1)
    conversation_id: Optional[int] = None
    scenario: IndustryScenarioKey = "auto"
    time_range: Optional[IndustryGraphTimeRange] = None
    top_k: int = Field(default=10, ge=1, le=20)


class IndustryGraphQueryPlan(BaseModel):
    """Resolved query plan."""

    primary_scenario: str = "technology_evolution"
    secondary_scenarios: List[str] = Field(default_factory=list)
    time_range: IndustryGraphTimeRange = Field(default_factory=IndustryGraphTimeRange)
    analysis_tasks: List[str] = Field(default_factory=list)
    entities: List[Dict[str, Any]] = Field(default_factory=list)
    output: List[str] = Field(default_factory=list)


class IndustryGraphNode(BaseModel):
    """Local graph node."""

    id: int
    entity_key: str
    entity_type: str
    label: str
    description: Optional[str] = None
    properties: Dict[str, Any] = Field(default_factory=dict)


class IndustryGraphEdge(BaseModel):
    """Local graph edge."""

    id: int
    source_id: int
    target_id: int
    relation_type: str
    confidence: str = "EXTRACTED"
    confidence_score: float = 1.0
    evidence_count: int = 0


class IndustryGraphSubgraph(BaseModel):
    """Local explanatory subgraph."""

    nodes: List[IndustryGraphNode] = Field(default_factory=list)
    edges: List[IndustryGraphEdge] = Field(default_factory=list)


class IndustryGraphEvidence(BaseModel):
    """Evidence card payload."""

    id: int
    relation_id: int
    document_id: int
    title: str
    title_zh: Optional[str] = None
    url: Optional[str] = None
    source: Optional[str] = None
    published_at: Optional[datetime] = None
    evidence_snippet: Optional[str] = None
    confidence: str = "EXTRACTED"
    confidence_score: float = 1.0


class IndustryGraphTrend(BaseModel):
    """Technology trend card payload."""

    technology_id: int
    technology: str
    trend_score: float = 0.0
    growth_rate: float = 0.0
    document_count: int = 0
    paper_count: int = 0
    product_count: int = 0
    company_count: int = 0
    benchmark_count: int = 0
    evidence_count: int = 0
    summary: str = ""


class IndustryGraphContentBlock(BaseModel):
    """Structured chat report block."""

    type: str
    data: Dict[str, Any] = Field(default_factory=dict)


class IndustryGraphSuggestedQuestion(BaseModel):
    """Suggested daily question."""

    id: int
    question: str
    scenario_key: str
    reason: Optional[str] = None
    hot_entities: List[Dict[str, Any]] = Field(default_factory=list)
    priority: int = 100
    generated_for_date: datetime


class IndustryGraphSuggestedQuestionListResponse(BaseModel):
    """Suggested question list response."""

    items: List[IndustryGraphSuggestedQuestion] = Field(default_factory=list)


class IndustryGraphProcessRequest(BaseModel):
    """Incremental article extraction request."""

    limit: int = Field(default=5, ge=1, le=50)
    article_ids: Optional[List[int]] = None
    force: bool = False
    import_first: bool = True


class IndustryGraphProcessedDocument(BaseModel):
    """Processed document summary."""

    document_id: int
    article_id: Optional[int] = None
    title: str
    title_zh: Optional[str] = None
    entities: int = 0
    relations: int = 0


class IndustryGraphProcessError(BaseModel):
    """Document extraction error."""

    document_id: int
    article_id: Optional[int] = None
    title: str
    error: str


class IndustryGraphProcessResponse(BaseModel):
    """Incremental article extraction response."""

    imported: int = 0
    import_skipped: int = 0
    processed: int = 0
    skipped: int = 0
    failed: int = 0
    entities_upserted: int = 0
    relations_upserted: int = 0
    evidence_upserted: int = 0
    processed_documents: List[IndustryGraphProcessedDocument] = Field(default_factory=list)
    errors: List[IndustryGraphProcessError] = Field(default_factory=list)


class IndustryGraphRebuildRequest(BaseModel):
    """Batch rebuild request for production migrations."""

    batch_size: int = Field(default=50, ge=1, le=50)
    max_documents: Optional[int] = Field(default=None, ge=1)
    clear_existing_graph: bool = False


class IndustryGraphRebuildResponse(BaseModel):
    """Batch rebuild summary."""

    imported: int = 0
    import_skipped: int = 0
    processed: int = 0
    skipped: int = 0
    failed: int = 0
    entities_upserted: int = 0
    relations_upserted: int = 0
    evidence_upserted: int = 0
    batches: int = 0
    cleared: Dict[str, int] = Field(default_factory=dict)
    errors: List[IndustryGraphProcessError] = Field(default_factory=list)
    stats: Dict[str, Any] = Field(default_factory=dict)


class IndustryGraphConversationMessage(BaseModel):
    """Conversation message payload."""

    id: int
    role: str
    content_text: Optional[str] = None
    content_blocks: List[IndustryGraphContentBlock] = Field(default_factory=list)
    query_plan: Optional[IndustryGraphQueryPlan] = None
    created_at: datetime


class IndustryGraphConversation(BaseModel):
    """Conversation payload."""

    id: int
    title: str
    primary_scenario: str
    created_at: datetime
    updated_at: datetime
    messages: List[IndustryGraphConversationMessage] = Field(default_factory=list)


class IndustryGraphConversationCreateRequest(BaseModel):
    """Create conversation request."""

    title: Optional[str] = None
    primary_scenario: str = "technology_evolution"


class IndustryGraphConversationRenameRequest(BaseModel):
    """Rename conversation request."""

    title: str = Field(..., min_length=1, max_length=500)


class IndustryGraphConversationListResponse(BaseModel):
    """Conversation list response."""

    items: List[IndustryGraphConversation] = Field(default_factory=list)


class IndustryGraphQueryResponse(BaseModel):
    """Chat-style industry graph query response."""

    question: str
    conversation_id: int
    query_plan: IndustryGraphQueryPlan
    content_blocks: List[IndustryGraphContentBlock] = Field(default_factory=list)
    trends: List[IndustryGraphTrend] = Field(default_factory=list)
    evidence: List[IndustryGraphEvidence] = Field(default_factory=list)
    subgraph: IndustryGraphSubgraph = Field(default_factory=IndustryGraphSubgraph)
    followup_questions: List[str] = Field(default_factory=list)


class IndustryGraphStatsResponse(BaseModel):
    """Industry graph statistics."""

    total_documents: int = 0
    processed_documents: int = 0
    pending_documents: int = 0
    failed_documents: int = 0
    total_entities: int = 0
    total_relations: int = 0
    total_evidence: int = 0
    total_conversations: int = 0
    latest_metric_generated_at: Optional[datetime] = None


class IndustryGraphStreamChunk(BaseModel):
    """SSE stream chunk."""

    type: IndustryGraphStreamType
    data: Dict[str, Any] = Field(default_factory=dict)
