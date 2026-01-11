"""
摘要相关的 Pydantic 模型
"""
from datetime import datetime
from typing import Optional, List, Dict
from pydantic import BaseModel, Field, ConfigDict


class DailySummaryBase(BaseModel):
    """每日摘要基础模型"""
    summary_type: str = Field(..., description="摘要类型: daily/weekly")
    summary_date: datetime
    start_date: datetime
    end_date: datetime
    summary_content: str
    total_articles: int = 0
    high_importance_count: int = 0
    medium_importance_count: int = 0
    key_topics: Optional[List[str]] = None
    recommended_articles: Optional[List[Dict]] = None


class DailySummaryCreate(DailySummaryBase):
    """创建摘要模型"""
    model_used: Optional[str] = None
    generation_time: Optional[float] = None
    
    model_config = ConfigDict(
        protected_namespaces=(),  # 允许使用 model_ 开头的字段名
    )


class DailySummary(DailySummaryBase):
    """摘要响应模型"""
    id: int
    model_used: Optional[str] = None
    generation_time: Optional[float] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(
        from_attributes=True,
        protected_namespaces=(),  # 允许使用 model_ 开头的字段名
    )


class DailySummaryListItem(BaseModel):
    """摘要列表项（简化版，不包含详细内容）"""
    id: int
    summary_type: str = Field(..., description="摘要类型: daily/weekly")
    summary_date: datetime
    start_date: datetime
    end_date: datetime
    total_articles: int = 0
    high_importance_count: int = 0
    medium_importance_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(
        from_attributes=True,
    )


class SummaryFieldsResponse(BaseModel):
    """摘要字段响应（按需加载）"""
    summary_content: Optional[str] = None
    key_topics: Optional[List[str]] = None
    recommended_articles: Optional[List[Dict]] = None


class SummaryGenerateRequest(BaseModel):
    """生成摘要请求"""
    summary_type: str = Field("daily", description="摘要类型: daily/weekly")
    date: Optional[str] = Field(None, description="指定日期 (YYYY-MM-DD格式)，仅当summary_type=daily时有效")
    week: Optional[str] = Field(None, description="指定周 (YYYY-WW格式，如2024-01表示2024年第1周)，仅当summary_type=weekly时有效")

