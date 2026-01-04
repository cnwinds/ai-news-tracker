"""
订阅源相关的 Pydantic 模型
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class RSSSourceBase(BaseModel):
    """RSS源基础模型"""
    name: str
    url: str
    description: Optional[str] = None
    category: Optional[str] = None
    tier: Optional[str] = None
    source_type: str = "rss"
    language: str = "en"
    enabled: bool = True
    priority: int = 1
    note: Optional[str] = None
    extra_config: Optional[str] = None


class RSSSourceCreate(RSSSourceBase):
    """创建RSS源模型"""
    pass


class RSSSourceUpdate(BaseModel):
    """更新RSS源模型"""
    name: Optional[str] = None
    url: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tier: Optional[str] = None
    enabled: Optional[bool] = None
    priority: Optional[int] = None
    note: Optional[str] = None
    extra_config: Optional[str] = None


class RSSSource(RSSSourceBase):
    """RSS源响应模型"""
    id: int
    last_collected_at: Optional[datetime] = None
    latest_article_published_at: Optional[datetime] = None
    articles_count: int = 0
    last_error: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True




