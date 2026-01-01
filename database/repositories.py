"""
数据访问层 - 封装常用数据库查询
"""
from datetime import datetime
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import Article, RSSSource, CollectionTask, CollectionLog


class ArticleRepository:
    """文章数据访问类"""

    @staticmethod
    def get_latest_dates_by_source(session: Session) -> dict[str, datetime]:
        """
        获取每个源的最新文章发布时间（使用聚合查询，避免加载所有文章）

        Args:
            session: 数据库会话

        Returns:
            字典 {source_name: latest_date}
        """
        results = (
            session.query(
                Article.source,
                func.max(Article.published_at).label('latest_date')
            )
            .filter(Article.published_at.isnot(None))
            .group_by(Article.source)
            .all()
        )

        return {r.source: r.latest_date for r in results}

    @staticmethod
    def get_articles_by_filters(
        session: Session,
        time_threshold: datetime = None,
        sources: list[str] = None,
        importance_values: list[str] = None,
        include_unimportance: bool = False,
        categories: list[str] = None,
        limit: int = 200
    ) -> list[Article]:
        """
        根据筛选条件获取文章

        Args:
            session: 数据库会话
            time_threshold: 时间阈值
            sources: 来源列表
            importance_values: 重要性列表
            include_unimportance: 是否包含未分析的文章
            categories: 分类列表
            limit: 返回数量限制

        Returns:
            文章列表
        """
        query = session.query(Article)

        if time_threshold:
            query = query.filter(Article.published_at >= time_threshold)

        if sources:
            query = query.filter(Article.source.in_(sources))

        if importance_values or include_unimportance:
            if include_unimportance:
                importance_values = importance_values or []
                if importance_values:
                    query = query.filter(
                        (Article.importance.in_(importance_values)) | (Article.importance == None)
                    )
                else:
                    query = query.filter(Article.importance == None)
            else:
                query = query.filter(Article.importance.in_(importance_values))

        if categories:
            query = query.filter(Article.category.in_(categories))

        articles = query.order_by(Article.published_at.desc()).limit(limit).all()

        for article in articles:
            _ = article.id
            _ = article.title
            _ = article.url
            _ = article.content
            _ = article.summary
            _ = article.source
            _ = article.category
            _ = article.author
            _ = article.published_at
            _ = article.importance
            _ = article.topics
            _ = article.tags
            _ = article.key_points
            _ = article.created_at

        session.expunge_all()

        return articles

    @staticmethod
    def get_stats(session: Session) -> dict:
        """
        获取文章统计信息

        Args:
            session: 数据库会话

        Returns:
            统计信息字典
        """
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

        total = session.query(Article).count()
        today = session.query(Article).filter(Article.created_at >= today_start).count()
        unanalyzed = session.query(Article).filter(Article.is_processed == False).count()
        high_importance = session.query(Article).filter(Article.importance == "high").count()

        return {
            "total": total,
            "today": today,
            "unanalyzed": unanalyzed,
            "high_importance": high_importance,
        }


class RSSSourceRepository:
    """RSS订阅源数据访问类"""

    @staticmethod
    def get_filtered_sources(
        session: Session,
        category: str = None,
        tier: str = None,
        enabled_only: bool = None
    ) -> list[RSSSource]:
        """
        根据条件获取订阅源

        Args:
            session: 数据库会话
            category: 分类筛选
            tier: 梯队筛选
            enabled_only: 是否只返回启用的源

        Returns:
            订阅源列表
        """
        query = session.query(RSSSource)

        if category and category != "全部":
            query = query.filter(RSSSource.category == category)

        if tier and tier != "全部":
            query = query.filter(RSSSource.tier == tier)

        if enabled_only is not None:
            if enabled_only:
                query = query.filter(RSSSource.enabled == True)
            else:
                query = query.filter(RSSSource.enabled == False)

        return query.order_by(RSSSource.priority.asc(), RSSSource.name.asc()).all()

    @staticmethod
    def get_sources_with_latest_articles(session: Session) -> dict[int, datetime]:
        """
        获取所有源及其最新文章的发布时间（优化版本）

        Args:
            session: 数据库会话

        Returns:
            字典 {source_id: latest_date}
        """
        latest_dates = ArticleRepository.get_latest_dates_by_source(session)

        result = {}
        for source in session.query(RSSSource).all():
            latest_date = None

            if source.latest_article_published_at:
                latest_date = source.latest_article_published_at
            else:
                source_name = source.name.strip()
                latest_date = latest_dates.get(source_name)

                if not latest_date:
                    for key in latest_dates.keys():
                        if source_name.lower() in key.lower() or key.lower() in source_name.lower():
                            latest_date = latest_dates[key]
                            break

            result[source.id] = latest_date

        return result

    @staticmethod
    def get_stats(session: Session) -> dict:
        """
        获取订阅源统计信息

        Args:
            session: 数据库会话

        Returns:
            统计信息字典
        """
        total = session.query(RSSSource).count()
        enabled = session.query(RSSSource).filter(RSSSource.enabled == True).count()
        disabled = total - enabled

        return {
            "total": total,
            "enabled": enabled,
            "disabled": disabled,
        }


class CollectionTaskRepository:
    """采集任务数据访问类"""

    @staticmethod
    def get_recent_tasks(session: Session, limit: int = 50) -> list[CollectionTask]:
        """
        获取最近的采集任务

        Args:
            session: 数据库会话
            limit: 返回数量限制

        Returns:
            任务列表
        """
        return (
            session.query(CollectionTask)
            .order_by(CollectionTask.started_at.desc())
            .limit(limit)
            .all()
        )

    @staticmethod
    def get_latest_task(session: Session) -> CollectionTask or None:
        """
        获取最新的采集任务

        Args:
            session: 数据库会话

        Returns:
            最新任务或None
        """
        return (
            session.query(CollectionTask)
            .order_by(CollectionTask.started_at.desc())
            .first()
        )


class CollectionLogRepository:
    """采集日志数据访问类"""

    @staticmethod
    def get_logs_for_task(
        session: Session,
        task: CollectionTask
    ) -> list[CollectionLog]:
        """
        获取指定任务的采集日志

        Args:
            session: 数据库会话
            task: 采集任务

        Returns:
            日志列表
        """
        query = session.query(CollectionLog).filter(
            CollectionLog.started_at >= task.started_at
        )

        if task.completed_at:
            query = query.filter(CollectionLog.started_at <= task.completed_at)

        return query.order_by(CollectionLog.started_at.desc()).all()
