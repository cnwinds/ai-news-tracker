"""
配置相关的 Pydantic 模型
"""
from typing import Literal, Optional, List
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


class SummaryPromptSettings(BaseModel):
    """总结提示词配置模型"""
    daily_summary_prompt: str = Field(..., description="每日总结提示词模板")
    weekly_summary_prompt: str = Field(..., description="每周总结提示词模板")


class LLMProviderBase(BaseModel):
    """LLM提供商基础模型"""
    name: str = Field(..., description="提供商名称")
    provider_type: str = Field(
        default="大模型(OpenAI)",
        description="提供商类型：大模型(OpenAI)/大模型(Anthropic)",
    )
    api_key: str = Field(..., description="API密钥")
    api_base: str = Field(..., description="API基础URL")
    llm_model: str = Field(..., description="大模型名称")
    embedding_model: Optional[str] = Field(None, description="向量模型名称（可选）")
    enabled: bool = Field(default=True, description="是否启用")


class LLMProviderCreate(LLMProviderBase):
    """创建LLM提供商模型"""
    pass


class LLMProviderUpdate(BaseModel):
    """更新LLM提供商模型"""
    name: Optional[str] = Field(None, description="提供商名称")
    provider_type: Optional[str] = Field(
        None,
        description="提供商类型：大模型(OpenAI)/大模型(Anthropic)",
    )
    api_key: Optional[str] = Field(None, description="API密钥")
    api_base: Optional[str] = Field(None, description="API基础URL")
    llm_model: Optional[str] = Field(None, description="大模型名称")
    embedding_model: Optional[str] = Field(None, description="向量模型名称（可选）")
    enabled: Optional[bool] = Field(None, description="是否启用")


class LLMProvider(LLMProviderBase):
    """LLM提供商模型"""
    id: int = Field(..., description="提供商ID")
    
    class Config:
        from_attributes = True


class LLMSettings(BaseModel):
    """LLM配置模型"""
    selected_llm_provider_id: Optional[int] = Field(None, description="选定的LLM提供商ID")
    selected_embedding_provider_id: Optional[int] = Field(None, description="选定的向量模型提供商ID")
    selected_llm_models: Optional[List[str]] = Field(None, description="选定的LLM模型列表")
    selected_embedding_models: Optional[List[str]] = Field(None, description="选定的向量模型列表")
    exploration_execution_mode: Optional[Literal["auto", "agent", "deterministic"]] = Field(
        default="auto",
        description="自主探索执行模式",
    )
    exploration_use_independent_provider: Optional[bool] = Field(
        default=False,
        description="自主探索是否使用独立模型提供商",
    )
    selected_exploration_provider_id: Optional[int] = Field(
        default=None,
        description="自主探索独立模型提供商ID",
    )
    selected_exploration_models: Optional[List[str]] = Field(
        default=None,
        description="自主探索独立模型列表",
    )


class CollectorSettings(BaseModel):
    """采集器配置模型"""
    collection_interval_hours: int = Field(..., ge=1, description="采集间隔（小时）")
    max_articles_per_source: int = Field(..., ge=1, description="每次采集每源最多获取文章数")
    request_timeout: int = Field(..., ge=1, description="请求超时（秒）")


class QuietHours(BaseModel):
    """勿扰时段模型"""
    start_time: str = Field(..., description="开始时间（格式：HH:MM，如22:00）")
    end_time: str = Field(..., description="结束时间（格式：HH:MM，如08:00）")


class NotificationSettings(BaseModel):
    """通知配置模型"""
    platform: str = Field(default="feishu", description="通知平台（feishu/dingtalk）")
    webhook_url: str = Field(default="", description="Webhook URL")
    secret: str = Field(default="", description="钉钉加签密钥（可选，仅钉钉需要）")
    instant_notification_enabled: bool = Field(default=True, description="是否启用即时通知")
    quiet_hours: Optional[List[QuietHours]] = Field(default=[], description="勿扰时段列表")


class ImageProviderBase(BaseModel):
    """图片生成提供商基础模型"""
    name: str = Field(..., description="提供商名称")
    provider_type: str = Field(default="文生图(BaiLian)", description="提供商类型：文生图(BaiLian) 或 文生图(智谱)")
    api_key: str = Field(..., description="API密钥")
    api_base: str = Field(..., description="API基础URL")
    image_model: str = Field(..., description="图片生成模型名称")
    enabled: bool = Field(default=True, description="是否启用")


class ImageProviderCreate(ImageProviderBase):
    """创建图片生成提供商模型"""
    pass


class ImageProviderUpdate(BaseModel):
    """更新图片生成提供商模型"""
    name: Optional[str] = Field(None, description="提供商名称")
    provider_type: Optional[str] = Field(None, description="提供商类型：文生图(BaiLian) 或 文生图(智谱)")
    api_key: Optional[str] = Field(None, description="API密钥")
    api_base: Optional[str] = Field(None, description="API基础URL")
    image_model: Optional[str] = Field(None, description="图片生成模型名称")
    enabled: Optional[bool] = Field(None, description="是否启用")


class ImageProvider(ImageProviderBase):
    """图片生成提供商模型"""
    id: int = Field(..., description="提供商ID")
    
    class Config:
        from_attributes = True


class ImageSettings(BaseModel):
    """图片生成配置模型"""
    selected_image_provider_id: Optional[int] = Field(None, description="选定的图片生成提供商ID")
    selected_image_models: Optional[List[str]] = Field(None, description="选定的图片生成模型列表")


class SocialMediaSettings(BaseModel):
    """社交平台配置模型"""
    youtube_api_key: Optional[str] = Field(None, description="YouTube API密钥")
    tiktok_api_key: Optional[str] = Field(None, description="TikTok API密钥")
    twitter_api_key: Optional[str] = Field(None, description="Twitter API密钥")
    reddit_client_id: Optional[str] = Field(None, description="Reddit客户端ID")
    reddit_client_secret: Optional[str] = Field(None, description="Reddit客户端密钥")
    reddit_user_agent: Optional[str] = Field(None, description="Reddit用户代理")
    auto_report_enabled: bool = Field(default=False, description="是否启用定时生成AI小报")
    auto_report_time: str = Field(default="09:00", description="定时生成时间（格式：HH:MM，如09:00）")


