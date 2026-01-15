"""
采集器相关的类型定义
"""
from datetime import datetime
from typing import TypedDict, Optional, List, Dict, Union


class ArticleDict(TypedDict, total=False):
    """文章字典类型定义"""
    title: str
    url: str
    content: Optional[str]
    source: str
    author: Optional[str]
    published_at: Optional[Union[str, datetime]]
    category: Optional[str]
    metadata: Optional[Dict[str, Union[str, int, float, bool, List]]]
    title_zh: Optional[str]
    summary: Optional[str]
    tags: Optional[List[str]]
    importance: Optional[str]
    target_audience: Optional[str]


class CollectorConfig(TypedDict, total=False):
    """采集器配置类型定义"""
    name: str
    url: str
    extra_config: Union[str, Dict[str, Union[str, int, float, bool, List, Dict, None]]]
    max_articles: Optional[int]
    source_type: Optional[str]
    sub_type: Optional[str]
    enabled: Optional[bool]
    priority: Optional[int]
    analysis_prompt: Optional[str]


class CollectionStats(TypedDict, total=False):
    """采集统计信息类型定义"""
    total_articles: int
    new_articles: int
    sources_success: int
    sources_error: int
    start_time: datetime
    end_time: Optional[datetime]
    duration: Optional[float]
    ai_analyzed_count: Optional[int]
    rag_indexed: Optional[int]


class SourceProcessStats(TypedDict, total=False):
    """单个源处理统计信息类型定义"""
    source_name: str
    total_articles: int
    new_articles: int
    skipped_articles: int
    ai_analyzed: int
    ai_skipped: int
    success: bool
    error: Optional[str]
