"""
数据库模型定义
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Float, JSON, Index, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class Article(Base):
    """文章表"""
    __tablename__ = "articles"

    # 复合索引 - 优化常用查询
    __table_args__ = (
        Index('idx_article_published_importance', 'published_at', 'importance'),
        Index('idx_article_source_published', 'source', 'published_at'),
        Index('idx_article_source_id_published', 'source_id', 'published_at'),
        Index('idx_article_published_sent', 'published_at', 'is_sent'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(500), nullable=False, index=True)
    title_zh = Column(String(500), nullable=True, index=True)  # 中文标题（翻译后）
    url = Column(String(1000), unique=True, nullable=False, index=True)
    content = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)  # 摘要：使用最多3句话总结内容
    detailed_summary = Column(Text, nullable=True)  # 精读：结构完整、信息齐全、逻辑严密的精简短文
    source_id = Column(Integer, ForeignKey('rss_sources.id'), nullable=True, index=True)
    source = Column(String(200), nullable=False, index=True)
    category = Column(String(100), nullable=True, index=True)
    author = Column(String(200), nullable=True)
    published_at = Column(DateTime, nullable=True, index=True)
    collected_at = Column(DateTime, default=datetime.now, nullable=False)

    # AI分析字段
    importance = Column(String(20), nullable=True)  # high/medium/low
    topics = Column(JSON, nullable=True)  # ["topic1", "topic2"]
    tags = Column(JSON, nullable=True)  # ["tag1", "tag2"]
    target_audience = Column(String(50), nullable=True)  # researcher/engineer/general
    key_points = Column(JSON, nullable=True)  # ["point1", "point2"]
    related_papers = Column(JSON, nullable=True)  # ["paper1", "paper2"]

    # 元数据
    extra_data = Column(JSON, nullable=True)  # 额外信息（避免使用metadata，这是SQLAlchemy保留字）
    is_processed = Column(Boolean, default=False)  # 是否已AI分析
    is_sent = Column(Boolean, default=False)  # 是否已推送
    is_favorited = Column(Boolean, default=False, index=True)  # 是否已收藏
    user_notes = Column(Text, nullable=True)  # 用户笔记：存储用户当时的思考或评论

    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    # 关系：Article属于RSSSource
    rss_source = relationship("RSSSource", backref="articles")

    def __repr__(self):
        return f"<Article(id={self.id}, title='{self.title[:50]}...', source='{self.source}')>"


class CollectionLog(Base):
    """采集日志表"""
    __tablename__ = "collection_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source_name = Column(String(200), nullable=False)
    source_type = Column(String(50), nullable=False)  # rss/api/web/email
    status = Column(String(20), nullable=False)  # success/error
    articles_count = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, default=datetime.now)
    completed_at = Column(DateTime, nullable=True)
    task_id = Column(Integer, nullable=True)  # 关联的采集任务ID

    def __repr__(self):
        return f"<CollectionLog(source='{self.source_name}', status='{self.status}', count={self.articles_count}, task_id={self.task_id})>"


class NotificationLog(Base):
    """推送日志表"""
    __tablename__ = "notification_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    notification_type = Column(String(50), nullable=False)  # daily_summary/instant
    platform = Column(String(50), nullable=False)  # feishu/dingtalk/email/telegram
    status = Column(String(20), nullable=False)  # success/error
    articles_count = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    sent_at = Column(DateTime, default=datetime.now)

    def __repr__(self):
        return f"<NotificationLog(type='{self.notification_type}', platform='{self.platform}', status='{self.status}')>"


class RSSSource(Base):
    """RSS订阅源表"""
    __tablename__ = "rss_sources"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False, unique=True, index=True)  # 源名称
    url = Column(String(1000), nullable=False, unique=True)  # RSS URL
    description = Column(Text, nullable=True)  # 简介/说明
    category = Column(String(100), nullable=True, index=True)  # 分类：corporate_lab/academic/individual/newsletter
    tier = Column(String(50), nullable=True, index=True)  # 梯队/级别：tier1/tier2/tier3
    source_type = Column(String(20), default="rss", nullable=False, index=True)  # 源类型：rss/api/web/email
    sub_type = Column(String(50), nullable=True, index=True)  # 源子类型：在源类型下进一步细分（如api下的arxiv/huggingface/paperswithcode，social下的twitter/reddit/hackernews）
    language = Column(String(20), default="en")  # 语言
    enabled = Column(Boolean, default=True, index=True)  # 是否启用
    priority = Column(Integer, default=1)  # 优先级（1-5，数字越小优先级越高）
    note = Column(Text, nullable=True)  # 备注信息
    extra_config = Column(Text, nullable=True)  # 扩展配置（JSON格式，用于Web/Social源的article_selector等）
    analysis_prompt = Column(Text, nullable=True)  # 自定义AI分析提示词
    parse_fix_history = Column(Text, nullable=True)  # 解析修复历史（JSON格式）

    # 统计信息
    last_collected_at = Column(DateTime, nullable=True)  # 最后采集时间
    latest_article_published_at = Column(DateTime, nullable=True)  # 最新文章的发布时间（用于判断源是否活跃）
    articles_count = Column(Integer, default=0)  # 采集到的文章总数
    last_error = Column(Text, nullable=True)  # 最后错误信息

    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def __repr__(self):
        return f"<RSSSource(id={self.id}, name='{self.name}', enabled={self.enabled})>"


class CollectionTask(Base):
    """采集任务表 - 记录每次整体采集任务"""
    __tablename__ = "collection_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    status = Column(String(20), nullable=False, default="running")  # running/completed/error
    new_articles_count = Column(Integer, default=0)  # 本次采集新增的文章数
    total_sources = Column(Integer, default=0)  # 采集的源总数
    success_sources = Column(Integer, default=0)  # 成功的源数量
    failed_sources = Column(Integer, default=0)  # 失败的源数量
    error_message = Column(Text, nullable=True)  # 错误信息
    duration = Column(Float, nullable=True)  # 采集耗时（秒）

    started_at = Column(DateTime, default=datetime.now, nullable=False)
    completed_at = Column(DateTime, nullable=True)

    # AI分析相关
    ai_enabled = Column(Boolean, default=False)  # 是否启用AI分析
    ai_analyzed_count = Column(Integer, default=0)  # AI分析的文章数

    created_at = Column(DateTime, default=datetime.now)

    def __repr__(self):
        return f"<CollectionTask(id={self.id}, status='{self.status}', new_articles={self.new_articles_count})>"


class DailySummary(Base):
    """每日/每周总结表"""
    __tablename__ = "daily_summaries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    summary_type = Column(String(20), nullable=False, index=True)  # daily/weekly
    summary_date = Column(DateTime, nullable=False, index=True)  # 总结日期
    start_date = Column(DateTime, nullable=False)  # 时间范围开始
    end_date = Column(DateTime, nullable=False)  # 时间范围结束

    # 统计信息
    total_articles = Column(Integer, default=0)  # 文章总数
    high_importance_count = Column(Integer, default=0)  # 高重要性文章数
    medium_importance_count = Column(Integer, default=0)  # 中重要性文章数

    # 总结内容
    summary_content = Column(Text, nullable=False)  # LLM生成的总结
    key_topics = Column(JSON, nullable=True)  # ["topic1", "topic2"]

    # 元数据
    model_used = Column(String(100), nullable=True)  # 使用的LLM模型
    generation_time = Column(Float, nullable=True)  # 生成耗时（秒）

    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def __repr__(self):
        return f"<DailySummary(id={self.id}, type='{self.summary_type}', date={self.summary_date})>"


class ArticleEmbedding(Base):
    """文章向量嵌入表"""
    __tablename__ = "article_embeddings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    article_id = Column(Integer, ForeignKey('articles.id'), nullable=False, unique=True, index=True)
    # 存储向量：使用JSON格式存储浮点数列表（同时同步到sqlite-vec的vec0虚拟表）
    embedding = Column(JSON, nullable=False)  # 嵌入向量列表
    text_content = Column(Text, nullable=False)  # 索引的文本内容（用于调试和重建）
    embedding_model = Column(String(100), nullable=True)  # 使用的嵌入模型
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    # 关系：ArticleEmbedding属于Article
    article = relationship("Article", backref="embedding")

    def __repr__(self):
        return f"<ArticleEmbedding(id={self.id}, article_id={self.article_id})>"


class AppSettings(Base):
    """应用配置表 - 存储应用级别的配置"""
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(100), nullable=False, unique=True, index=True)  # 配置键
    value = Column(Text, nullable=True)  # 配置值（JSON格式或字符串）
    value_type = Column(String(20), nullable=False, default="string")  # 值类型：string/int/bool/json
    description = Column(Text, nullable=True)  # 配置说明
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def __repr__(self):
        return f"<AppSettings(key='{self.key}', value='{self.value}')>"


class LLMProvider(Base):
    """LLM提供商表 - 存储多个AI提供商的配置"""
    __tablename__ = "llm_providers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False, unique=True, index=True)  # 提供商名称
    provider_type = Column(String(50), nullable=False, default="大模型(OpenAI)")  # 提供商类型：大模型(OpenAI)
    api_key = Column(String(500), nullable=False)  # API密钥
    api_base = Column(String(500), nullable=False)  # API基础URL
    llm_model = Column(String(500), nullable=False)  # 大模型名称（支持逗号分隔的多个模型）
    embedding_model = Column(String(500), nullable=True)  # 向量模型名称（可选，支持逗号分隔的多个模型）
    enabled = Column(Boolean, default=True, index=True)  # 是否启用
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def __repr__(self):
        return f"<LLMProvider(id={self.id}, name='{self.name}', enabled={self.enabled})>"


class ImageProvider(Base):
    """图片生成提供商表 - 存储多个图片生成提供商的配置"""
    __tablename__ = "image_providers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False, unique=True, index=True)  # 提供商名称
    provider_type = Column(String(50), nullable=False, default="文生图(BaiLian)")  # 提供商类型：文生图(BaiLian) 或 文生图(智谱)
    api_key = Column(String(500), nullable=False)  # API密钥
    api_base = Column(String(500), nullable=False)  # API基础URL
    image_model = Column(String(500), nullable=False)  # 图片生成模型名称（支持逗号分隔的多个模型）
    enabled = Column(Boolean, default=True, index=True)  # 是否启用
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def __repr__(self):
        return f"<ImageProvider(id={self.id}, name='{self.name}', enabled={self.enabled})>"


class SocialMediaPost(Base):
    """社交平台热帖表"""
    __tablename__ = "social_media_posts"

    # 复合索引 - 优化常用查询
    __table_args__ = (
        Index('idx_social_platform_date', 'platform', 'published_at'),
        Index('idx_social_collected_date', 'collected_at'),
        Index('idx_social_viral_score', 'platform', 'viral_score'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)

    # 基本信息
    platform = Column(String(50), nullable=False, index=True)  # youtube/tiktok/twitter
    post_id = Column(String(200), nullable=False, index=True)  # 平台上的唯一ID
    title = Column(String(1000), nullable=True)  # 标题/描述
    content = Column(Text, nullable=True)  # 内容/正文
    title_zh = Column(String(1000), nullable=True)  # 中文翻译

    # 作者信息
    author_id = Column(String(200), nullable=True)  # 作者ID
    author_name = Column(String(200), nullable=True)  # 作者名称
    author_url = Column(String(1000), nullable=True)  # 作者主页链接
    follower_count = Column(Integer, default=0)  # 作者粉丝数

    # 统计数据
    view_count = Column(Integer, default=0)  # 观看/浏览量
    like_count = Column(Integer, default=0)  # 点赞数
    comment_count = Column(Integer, default=0)  # 评论数
    share_count = Column(Integer, default=0)  # 分享/转发数
    favorite_count = Column(Integer, default=0)  # 收藏数

    # 爆款指标
    viral_score = Column(Float, nullable=True)  # 爆款指数
    viral_metrics = Column(JSON, nullable=True)  # 爆款指标详情

    # 链接信息
    post_url = Column(String(1000), nullable=False)  # 帖子链接
    thumbnail_url = Column(String(1000), nullable=True)  # 缩略图链接

    # 时间信息
    published_at = Column(DateTime, nullable=True, index=True)  # 发布时间
    collected_at = Column(DateTime, default=datetime.now, nullable=False)  # 采集时间

    # AI分析
    has_value = Column(Boolean, nullable=True)  # 是否有信息价值
    value_reason = Column(Text, nullable=True)  # 价值判断理由
    is_processed = Column(Boolean, default=False)  # 是否已AI处理

    # 扩展数据
    extra_data = Column(JSON, nullable=True)  # 额外信息

    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def __repr__(self):
        return f"<SocialMediaPost(id={self.id}, platform='{self.platform}', title='{self.title[:50] if self.title else ''}...')>"


class SocialMediaReport(Base):
    """社交平台热帖日报表"""
    __tablename__ = "social_media_reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_date = Column(DateTime, nullable=False, index=True)  # 报告日期

    # 统计信息
    youtube_count = Column(Integer, default=0)  # YouTube热帖数量
    tiktok_count = Column(Integer, default=0)  # TikTok热帖数量
    twitter_count = Column(Integer, default=0)  # Twitter热帖数量
    reddit_count = Column(Integer, default=0)  # Reddit热帖数量
    total_count = Column(Integer, default=0)  # 总数量

    # 报告内容
    report_content = Column(Text, nullable=False)  # Markdown格式的报告

    # 平台配置
    youtube_enabled = Column(Boolean, default=False)  # 是否启用YouTube采集
    tiktok_enabled = Column(Boolean, default=False)  # 是否启用TikTok采集
    twitter_enabled = Column(Boolean, default=False)  # 是否启用Twitter采集
    reddit_enabled = Column(Boolean, default=False)  # 是否启用Reddit采集

    # 元数据
    model_used = Column(String(100), nullable=True)  # 使用的LLM模型
    generation_time = Column(Float, nullable=True)  # 生成耗时(秒)

    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def __repr__(self):
        return f"<SocialMediaReport(id={self.id}, date={self.report_date}, total={self.total_count})>"


class AccessLog(Base):
    """访问日志表 - 记录用户访问行为"""
    __tablename__ = "access_logs"

    # 复合索引 - 优化常用查询
    __table_args__ = (
        Index('idx_access_date_user', 'access_date', 'user_id'),
        Index('idx_access_date_type', 'access_date', 'access_type'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    access_date = Column(DateTime, nullable=False, index=True)  # 访问日期（用于按日统计）
    user_id = Column(String(200), nullable=False, index=True)  # 用户标识（可以是用户名或session_id）
    access_type = Column(String(50), nullable=False, index=True)  # 访问类型：page_view/click/api_call
    page_path = Column(String(500), nullable=True)  # 页面路径
    action = Column(String(200), nullable=True)  # 具体操作（如：查看文章、点击按钮等）
    ip_address = Column(String(50), nullable=True)  # IP地址
    user_agent = Column(String(500), nullable=True)  # 用户代理（浏览器信息）
    extra_data = Column(JSON, nullable=True)  # 额外数据
    created_at = Column(DateTime, default=datetime.now, nullable=False)

    def __repr__(self):
        return f"<AccessLog(id={self.id}, date={self.access_date}, user={self.user_id}, type={self.access_type})>"


class ExplorationTask(Base):
    """自主探索任务表"""
    __tablename__ = "exploration_tasks"

    __table_args__ = (
        Index('idx_exploration_status_created', 'status', 'created_at'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(64), unique=True, nullable=False, index=True)  # 任务唯一标识
    status = Column(String(20), nullable=False, index=True)  # pending/running/completed/failed
    source = Column(String(50), nullable=False)  # 发现来源：github/huggingface/arxiv/all
    model_name = Column(String(255), nullable=False)  # 模型名称
    model_url = Column(String(512), nullable=True)  # 模型URL
    discovery_time = Column(DateTime, nullable=False, index=True)  # 发现时间
    start_time = Column(DateTime, nullable=True)  # 开始研究时间
    end_time = Column(DateTime, nullable=True)  # 完成时间
    error_message = Column(Text, nullable=True)  # 错误信息
    progress = Column(JSON, nullable=True)  # 进度信息
    created_at = Column(DateTime, default=datetime.now, nullable=False)

    def __repr__(self):
        return f"<ExplorationTask(id={self.id}, task_id='{self.task_id}', status='{self.status}')>"


class DiscoveredModel(Base):
    """发现的模型表"""
    __tablename__ = "discovered_models"

    __table_args__ = (
        Index('idx_model_score_date', 'final_score', 'release_date'),
        Index('idx_model_status_score', 'status', 'final_score'),
        Index('idx_model_source_uid_unique', 'source_platform', 'source_uid', unique=True),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    model_name = Column(String(255), nullable=False, index=True)  # 模型名称（展示字段，不再作为唯一键）
    model_type = Column(String(50), nullable=True)  # 模型类型：LLM/Vision/Audio/Multimodal等
    organization = Column(String(255), nullable=True)  # 发布组织
    release_date = Column(DateTime, nullable=True, index=True)  # 发布日期
    source_platform = Column(String(50), nullable=False)  # 来源平台：github/huggingface/modelscope/arxiv
    source_uid = Column(String(512), nullable=False, index=True)  # 源内唯一标识（如 owner/repo、org/model、arxiv_id）
    github_url = Column(String(512), nullable=True)  # GitHub地址
    paper_url = Column(String(512), nullable=True)  # 论文地址
    model_url = Column(String(512), nullable=True)  # 模型地址（HF等）
    license = Column(String(50), nullable=True)  # 开源协议
    description = Column(Text, nullable=True)  # 描述

    # 影响力指标
    github_stars = Column(Integer, default=0)
    github_forks = Column(Integer, default=0)
    paper_citations = Column(Integer, default=0)
    social_mentions = Column(Integer, default=0)

    # 评分
    impact_score = Column(Float, nullable=True)  # 影响力评分（0-100）
    quality_score = Column(Float, nullable=True)  # 质量评分（0-100）
    innovation_score = Column(Float, nullable=True)  # 创新性评分（0-100）
    practicality_score = Column(Float, nullable=True)  # 实用性评分（0-100）
    final_score = Column(Float, nullable=True, index=True)  # 综合评分（0-100）

    # 元数据
    status = Column(String(20), default='discovered', index=True)  # discovered/evaluated/analyzed/reported
    is_notable = Column(Boolean, default=False, index=True)  # 是否值得深度研究
    extra_data = Column(JSON, nullable=True)  # 额外数据
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def __repr__(self):
        return f"<DiscoveredModel(id={self.id}, name='{self.model_name}', score={self.final_score})>"


class ExplorationReport(Base):
    """自主探索报告表"""
    __tablename__ = "exploration_reports"

    __table_args__ = (
        Index('idx_report_model_generated', 'model_id', 'generated_at'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(String(64), unique=True, nullable=False, index=True)  # 报告唯一标识
    task_id = Column(String(64), nullable=False, index=True)  # 关联的任务ID
    model_id = Column(Integer, ForeignKey('discovered_models.id'), nullable=False, index=True)  # 关联的模型ID

    # 报告内容
    title = Column(String(255), nullable=False)  # 报告标题
    summary = Column(Text, nullable=True)  # 摘要
    highlights = Column(JSON, nullable=True)  # 核心亮点（数组）
    technical_analysis = Column(Text, nullable=True)  # 技术分析
    performance_analysis = Column(Text, nullable=True)  # 性能分析
    code_analysis = Column(Text, nullable=True)  # 代码分析
    use_cases = Column(JSON, nullable=True)  # 应用场景（数组）
    risks = Column(JSON, nullable=True)  # 风险评估（数组）
    recommendations = Column(JSON, nullable=True)  # 使用建议（数组）
    references = Column(JSON, nullable=True)  # 参考链接（对象）
    full_report = Column(Text, nullable=True)  # 完整报告（Markdown格式）

    # 报告元数据
    report_version = Column(String(20), default='1.0')
    agent_version = Column(String(20), nullable=True)  # Agent版本
    model_used = Column(String(100), nullable=True)  # 使用的LLM模型
    generation_time = Column(Float, nullable=True)  # 生成耗时(秒)
    generated_at = Column(DateTime, default=datetime.now, nullable=False, index=True)

    # 关系
    discovered_model = relationship("DiscoveredModel", backref="reports")

    def __repr__(self):
        return f"<ExplorationReport(id={self.id}, report_id='{self.report_id}', model_id={self.model_id})>"
