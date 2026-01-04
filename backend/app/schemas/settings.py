"""
配置相关的 Pydantic 模型
"""
from pydantic import BaseModel, Field


class CollectionSettings(BaseModel):
    """采集配置模型"""
    max_article_age_days: int = Field(..., ge=0, description="文章采集最大天数")
    max_analysis_age_days: int = Field(..., ge=0, description="AI分析最大天数")


class AutoCollectionSettings(BaseModel):
    """自动采集配置模型"""
    enabled: bool = Field(default=False, description="是否启用自动采集")
    interval_hours: int = Field(default=1, ge=1, description="采集间隔（小时）")
    max_articles_per_source: int = Field(default=20, ge=1, description="每次采集每源最多获取文章数")
    request_timeout: int = Field(default=30, ge=1, description="请求超时（秒）")


class SummarySettings(BaseModel):
    """总结配置模型"""
    daily_summary_enabled: bool = Field(default=True, description="是否启用每日总结")
    daily_summary_time: str = Field(default="09:00", description="每日总结时间（格式：HH:MM，如09:00）")
    weekly_summary_enabled: bool = Field(default=True, description="是否启用每周总结")
    weekly_summary_time: str = Field(default="09:00", description="每周总结时间（格式：HH:MM，如09:00，在周六执行）")


class LLMSettings(BaseModel):
    """LLM配置模型"""
    openai_api_key: str = Field(..., description="OpenAI API密钥")
    openai_api_base: str = Field(default="https://api.openai.com/v1", description="OpenAI API基础URL")
    openai_model: str = Field(default="gpt-4-turbo-preview", description="OpenAI模型名称")
    openai_embedding_model: str = Field(default="text-embedding-3-small", description="OpenAI嵌入模型名称")


class CollectorSettings(BaseModel):
    """采集器配置模型"""
    collection_interval_hours: int = Field(..., ge=1, description="采集间隔（小时）")
    max_articles_per_source: int = Field(..., ge=1, description="每次采集每源最多获取文章数")
    request_timeout: int = Field(..., ge=1, description="请求超时（秒）")


class NotificationSettings(BaseModel):
    """通知配置模型"""
    platform: str = Field(default="feishu", description="通知平台（feishu/dingtalk）")
    webhook_url: str = Field(default="", description="Webhook URL")
    secret: str = Field(default="", description="钉钉加签密钥（可选，仅钉钉需要）")
    instant_notification_enabled: bool = Field(default=True, description="是否启用即时通知")


