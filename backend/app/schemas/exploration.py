"""
自主探索相关 Schema
"""
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


ALLOWED_EXPLORATION_SOURCES = {"github", "huggingface", "arxiv", "modelscope"}


class ExplorationTaskCreate(BaseModel):
    """启动探索任务请求"""

    sources: List[str] = Field(default_factory=lambda: ["github", "huggingface", "arxiv", "modelscope"])
    min_score: float = Field(default=70.0, ge=0.0, le=100.0)
    days_back: int = Field(default=7, ge=1, le=30)
    max_results_per_source: int = Field(default=30, ge=1, le=200)
    keywords: Optional[List[str]] = None
    watch_organizations: Optional[List[str]] = Field(
        default=None,
        description="重点监控的厂商/组织列表，如 openai、deepseek-ai、Qwen 等",
    )
    run_mode: Literal["auto", "deterministic", "agent"] = Field(
        default="auto",
        description="执行模式：auto(按系统配置)、deterministic(规则模式)、agent(Agent模式)",
    )

    @field_validator("sources")
    @classmethod
    def validate_sources(cls, value: List[str]) -> List[str]:
        cleaned = [s.strip().lower() for s in value if s and s.strip()]
        if not cleaned:
            raise ValueError("sources 不能为空")
        invalid = [s for s in cleaned if s not in ALLOWED_EXPLORATION_SOURCES]
        if invalid:
            raise ValueError(f"不支持的数据源: {', '.join(invalid)}")
        # 去重并保序
        deduped: List[str] = []
        for source in cleaned:
            if source not in deduped:
                deduped.append(source)
        return deduped

    @field_validator("watch_organizations")
    @classmethod
    def validate_watch_organizations(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return None
        cleaned: List[str] = []
        for item in value:
            name = (item or "").strip()
            if not name:
                continue
            lowered = name.lower()
            if lowered not in cleaned:
                cleaned.append(lowered)
        return cleaned[:50] or None


class ExplorationConfigResponse(BaseModel):
    """模型先知配置响应"""

    monitor_sources: List[str] = Field(default_factory=list)
    watch_organizations: List[str] = Field(default_factory=list)
    min_score: float = Field(default=70.0, ge=0.0, le=100.0)
    days_back: int = Field(default=2, ge=1, le=30)
    max_results_per_source: int = Field(default=30, ge=1, le=200)
    run_mode: Literal["auto", "deterministic", "agent"] = Field(default="auto")
    auto_monitor_enabled: bool = Field(default=False)
    auto_monitor_interval_hours: int = Field(default=24, ge=1, le=168)


class ExplorationConfigUpdate(BaseModel):
    """模型先知配置更新请求"""

    monitor_sources: List[str] = Field(default_factory=lambda: ["github", "huggingface", "arxiv", "modelscope"])
    watch_organizations: List[str] = Field(default_factory=list)
    min_score: float = Field(default=70.0, ge=0.0, le=100.0)
    days_back: int = Field(default=2, ge=1, le=30)
    max_results_per_source: int = Field(default=30, ge=1, le=200)
    run_mode: Literal["auto", "deterministic", "agent"] = Field(default="auto")
    auto_monitor_enabled: bool = Field(default=False)
    auto_monitor_interval_hours: int = Field(default=24, ge=1, le=168)

    @field_validator("monitor_sources")
    @classmethod
    def validate_monitor_sources(cls, value: List[str]) -> List[str]:
        cleaned = [s.strip().lower() for s in value if s and s.strip()]
        if not cleaned:
            raise ValueError("monitor_sources 不能为空")
        invalid = [s for s in cleaned if s not in ALLOWED_EXPLORATION_SOURCES]
        if invalid:
            raise ValueError(f"不支持的数据源: {', '.join(invalid)}")
        deduped: List[str] = []
        for source in cleaned:
            if source not in deduped:
                deduped.append(source)
        return deduped

    @field_validator("watch_organizations")
    @classmethod
    def validate_watch_organizations(cls, value: List[str]) -> List[str]:
        cleaned: List[str] = []
        for item in value:
            name = (item or "").strip()
            if not name:
                continue
            lowered = name.lower()
            if lowered not in cleaned:
                cleaned.append(lowered)
        return cleaned[:50]


class ExplorationTaskStartResponse(BaseModel):
    """启动任务响应"""

    task_id: str
    status: str
    message: str


class ExplorationTaskProgress(BaseModel):
    """任务进度"""

    current_stage: str
    models_discovered: int = 0
    models_evaluated: int = 0
    updates_detected: int = 0
    release_candidates: int = 0
    notable_models: int = 0
    reports_generated: int = 0
    source_results: Dict[str, int] = Field(default_factory=dict)
    model_id: Optional[int] = None
    report_id: Optional[str] = None


class ExplorationTaskResponse(BaseModel):
    """任务详情响应"""

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    task_id: str
    status: str
    source: str
    model_name: str
    discovery_time: datetime
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    error_message: Optional[str] = None
    progress: Optional[Dict[str, Any]] = None
    created_at: datetime


class ExplorationTaskListResponse(BaseModel):
    """任务列表响应"""

    tasks: List[ExplorationTaskResponse]
    total: int
    page: int


class DiscoveredModelResponse(BaseModel):
    """模型摘要响应"""

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: int
    model_name: str
    model_type: Optional[str] = None
    organization: Optional[str] = None
    release_date: Optional[datetime] = None
    source_platform: str
    source_uid: str
    github_stars: int = 0
    github_forks: int = 0
    paper_citations: int = 0
    social_mentions: int = 0
    impact_score: Optional[float] = None
    quality_score: Optional[float] = None
    innovation_score: Optional[float] = None
    practicality_score: Optional[float] = None
    final_score: Optional[float] = None
    is_notable: bool
    status: str
    extra_data: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class DiscoveredModelListResponse(BaseModel):
    """模型列表响应"""

    models: List[DiscoveredModelResponse]
    total: int
    page: int


class ExplorationReportSummaryResponse(BaseModel):
    """报告摘要响应"""

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    report_id: str
    task_id: str
    model_id: int
    title: str
    summary: Optional[str] = None
    highlights: Optional[List[str]] = None
    generated_at: datetime


class ExplorationModelDetailResponse(BaseModel):
    """模型详情响应"""

    model: DiscoveredModelResponse
    reports: List[ExplorationReportSummaryResponse]


class ExplorationReportResponse(BaseModel):
    """报告详情响应"""

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    report_id: str
    task_id: str
    model_id: int
    title: str
    summary: Optional[str] = None
    highlights: Optional[List[str]] = None
    technical_analysis: Optional[str] = None
    performance_analysis: Optional[str] = None
    code_analysis: Optional[str] = None
    use_cases: Optional[List[str]] = None
    risks: Optional[List[str]] = None
    recommendations: Optional[List[str]] = None
    references: Optional[Dict[str, str]] = None
    full_report: Optional[str] = None
    generated_at: datetime


class ExplorationReportListResponse(BaseModel):
    """报告列表响应"""

    reports: List[ExplorationReportSummaryResponse]
    total: int
    page: int


class ExplorationModelMarkRequest(BaseModel):
    """手动标记模型请求"""

    is_notable: bool
    notes: Optional[str] = None


class ExplorationGenerateReportResponse(BaseModel):
    """手动生成报告响应"""

    model_config = ConfigDict(protected_namespaces=())

    message: str
    model_id: int
    task_id: str
    report_id: Optional[str] = None
    status: str


class ExplorationStatisticsResponse(BaseModel):
    """探索统计响应"""

    total_models_discovered: int
    notable_models: int
    reports_generated: int
    avg_final_score: float
    by_source: Dict[str, int]
    by_model_type: Dict[str, int]


ExplorationModelSortBy = Literal["final_score", "release_date", "github_stars", "created_at"]
ExplorationOrderBy = Literal["asc", "desc"]
