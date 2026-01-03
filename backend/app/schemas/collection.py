"""
采集相关的 Pydantic 模型
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class CollectionTaskBase(BaseModel):
    """采集任务基础模型"""
    status: str
    new_articles_count: int = 0
    total_sources: int = 0
    success_sources: int = 0
    failed_sources: int = 0
    error_message: Optional[str] = None
    duration: Optional[float] = None
    ai_enabled: bool = False
    ai_analyzed_count: int = 0


class CollectionTaskCreate(BaseModel):
    """创建采集任务模型"""
    enable_ai: bool = True


class CollectionTask(CollectionTaskBase):
    """采集任务响应模型"""
    id: int
    started_at: datetime
    completed_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CollectionTaskStatus(BaseModel):
    """采集任务状态"""
    task_id: int
    status: str
    message: str
    stats: Optional[dict] = None


class CollectionStats(BaseModel):
    """采集统计信息"""
    total_articles: int
    new_articles: int
    sources_success: int
    sources_error: int
    duration: float
    analyzed_count: Optional[int] = None



