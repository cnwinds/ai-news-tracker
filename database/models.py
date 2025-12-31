"""
数据库模型定义
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Float, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()


class Article(Base):
    """文章表"""
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(500), nullable=False, index=True)
    url = Column(String(1000), unique=True, nullable=False, index=True)
    content = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
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
    metadata = Column(JSON, nullable=True)  # 额外信息
    is_processed = Column(Boolean, default=False)  # 是否已AI分析
    is_sent = Column(Boolean, default=False)  # 是否已推送

    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

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
