"""
统计相关的 Pydantic 模型
"""
from typing import Dict, List
from pydantic import BaseModel


class Statistics(BaseModel):
    """统计数据响应模型"""
    total_articles: int
    today_count: int
    high_importance: int
    medium_importance: int
    low_importance: int
    unanalyzed: int
    source_distribution: Dict[str, int]
    category_distribution: Dict[str, int]
    importance_distribution: Dict[str, int]



