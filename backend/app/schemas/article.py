"""
文章相关的 Pydantic 模型
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class ArticleBase(BaseModel):
    """文章基础模型"""
    title: str
    title_zh: Optional[str] = None
    url: str
    content: Optional[str] = None
    summary: Optional[str] = None
    source: str
    source_id: Optional[int] = None
    category: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[datetime] = None


class ArticleCreate(ArticleBase):
    """创建文章模型"""
    pass


class ArticleUpdate(BaseModel):
    """更新文章模型"""
    title: Optional[str] = None
    title_zh: Optional[str] = None
    content: Optional[str] = None
    summary: Optional[str] = None
    importance: Optional[str] = None
    topics: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    key_points: Optional[List[str]] = None
    is_processed: Optional[bool] = None


class Article(ArticleBase):
    """文章响应模型"""
    id: int
    importance: Optional[str] = None
    topics: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    target_audience: Optional[str] = None
    key_points: Optional[List[str]] = None
    related_papers: Optional[List[str]] = None
    extra_data: Optional[dict] = None
    is_processed: bool = False
    is_sent: bool = False
    collected_at: datetime
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ArticleFilter(BaseModel):
    """文章筛选模型"""
    time_range: Optional[str] = Field(None, description="时间范围: 今天/最近3天/最近7天/最近30天/全部")
    sources: Optional[List[str]] = Field(None, description="来源列表")
    importance: Optional[List[str]] = Field(None, description="重要性列表: high/medium/low/未分析")
    category: Optional[List[str]] = Field(None, description="分类列表")
    page: int = Field(1, ge=1, description="页码")
    page_size: int = Field(20, ge=1, le=100, description="每页数量")


class ArticleListResponse(BaseModel):
    """文章列表响应"""
    items: List[Article]
    total: int
    page: int
    page_size: int
    total_pages: int



