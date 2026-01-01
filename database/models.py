"""
数据库模型定义
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Float, JSON, Index, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

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
    summary = Column(Text, nullable=True)
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
    source_type = Column(String(50), nullable=False)  # rss/api/web/social
    status = Column(String(20), nullable=False)  # success/error
    articles_count = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, default=datetime.now)
    completed_at = Column(DateTime, nullable=True)

    def __repr__(self):
        return f"<CollectionLog(source='{self.source_name}', status='{self.status}', count={self.articles_count})>"


class NotificationLog(Base):
    """推送日志表"""
    __tablename__ = "notification_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    notification_type = Column(String(50), nullable=False)  # daily_summary/instant
    platform = Column(String(50), nullable=False)  # feishu/email/telegram
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
    source_type = Column(String(20), default="rss", nullable=False, index=True)  # 源类型：rss/api/web/social
    language = Column(String(20), default="en")  # 语言
    enabled = Column(Boolean, default=True, index=True)  # 是否启用
    priority = Column(Integer, default=1)  # 优先级（1-5，数字越小优先级越高）
    note = Column(Text, nullable=True)  # 备注信息

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
    recommended_articles = Column(JSON, nullable=True)  # [{"id": 1, "title": "xxx", "reason": "xxx"}]

    # 元数据
    model_used = Column(String(100), nullable=True)  # 使用的LLM模型
    generation_time = Column(Float, nullable=True)  # 生成耗时（秒）

    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def __repr__(self):
        return f"<DailySummary(id={self.id}, type='{self.summary_type}', date={self.summary_date})>"
