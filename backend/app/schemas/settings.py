"""
配置相关的 Pydantic 模型
"""
from pydantic import BaseModel, Field


class CollectionSettings(BaseModel):
    """采集配置模型"""
    max_article_age_days: int = Field(..., ge=0, description="文章采集最大天数")
    max_analysis_age_days: int = Field(..., ge=0, description="AI分析最大天数")



