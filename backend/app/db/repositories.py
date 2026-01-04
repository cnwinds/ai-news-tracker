"""
数据访问层 - 封装常用数据库查询
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.db.models import Article, RSSSource, CollectionTask, CollectionLog, AppSettings, LLMProvider


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

    @staticmethod
    def delete_article(session: Session, article_id: int) -> bool:
        """
        删除指定的文章

        Args:
            session: 数据库会话
            article_id: 文章ID

        Returns:
            是否删除成功
        """
        try:
            article = session.query(Article).filter(Article.id == article_id).first()
            if article:
                # 先删除关联的 ArticleEmbedding 记录
                from backend.app.db.models import ArticleEmbedding
                session.query(ArticleEmbedding).filter(
                    ArticleEmbedding.article_id == article_id
                ).delete()
                
                # 删除 vec_embeddings 表中的相关记录（如果使用了 sqlite-vec）
                try:
                    from sqlalchemy import text
                    session.execute(
                        text("DELETE FROM vec_embeddings WHERE article_id = :article_id"),
                        {"article_id": article_id}
                    )
                except Exception:
                    # vec_embeddings 表可能不存在，忽略错误
                    pass
                
                # 然后删除文章
                session.delete(article)
                session.commit()
                return True
            return False
        except Exception as e:
            session.rollback()
            raise e


class RSSSourceRepository:
    """RSS订阅源数据访问类"""

    @staticmethod
    def get_filtered_sources(
        session: Session,
        category: str = None,
        tier: str = None,
        source_type: str = None,
        enabled_only: bool = None
    ) -> list[RSSSource]:
        """
        根据条件获取订阅源

        Args:
            session: 数据库会话
            category: 分类筛选
            tier: 梯队筛选
            source_type: 源类型筛选 (rss/api/web/social)
            enabled_only: 是否只返回启用的源

        Returns:
            订阅源列表
        """
        query = session.query(RSSSource)

        if category and category != "全部":
            query = query.filter(RSSSource.category == category)

        if tier and tier != "全部":
            query = query.filter(RSSSource.tier == tier)

        if source_type and source_type != "全部":
            query = query.filter(RSSSource.source_type == source_type)

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
    def get_latest_task(session: Session) -> Optional[CollectionTask]:
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
            CollectionLog.task_id == task.id
        )

        return query.order_by(CollectionLog.started_at.desc()).all()


class AppSettingsRepository:
    """应用配置数据访问类"""

    @staticmethod
    def get_setting(session: Session, key: str, default_value=None):
        """
        获取配置值

        Args:
            session: 数据库会话
            key: 配置键
            default_value: 默认值

        Returns:
            配置值
        """
        setting = session.query(AppSettings).filter(AppSettings.key == key).first()
        if not setting:
            return default_value
        
        # 根据类型转换值
        if setting.value_type == "int":
            return int(setting.value) if setting.value else default_value
        elif setting.value_type == "bool":
            return setting.value.lower() in ("true", "1", "yes") if setting.value else default_value
        elif setting.value_type == "json":
            import json
            return json.loads(setting.value) if setting.value else default_value
        else:
            return setting.value if setting.value else default_value

    @staticmethod
    def set_setting(session: Session, key: str, value, value_type: str = "string", description: str = None):
        """
        设置配置值

        Args:
            session: 数据库会话
            key: 配置键
            value: 配置值
            value_type: 值类型（string/int/bool/json）
            description: 配置说明

        Returns:
            是否成功
        """
        try:
            # 转换值为字符串
            if value_type == "json":
                import json
                value_str = json.dumps(value, ensure_ascii=False)
            else:
                value_str = str(value)
            
            setting = session.query(AppSettings).filter(AppSettings.key == key).first()
            if setting:
                setting.value = value_str
                setting.value_type = value_type
                if description:
                    setting.description = description
            else:
                setting = AppSettings(
                    key=key,
                    value=value_str,
                    value_type=value_type,
                    description=description
                )
                session.add(setting)
            
            session.commit()
            return True
        except Exception as e:
            session.rollback()
            raise e

    @staticmethod
    def get_all_settings(session: Session) -> dict:
        """
        获取所有配置

        Args:
            session: 数据库会话

        Returns:
            配置字典 {key: value}
        """
        settings = session.query(AppSettings).all()
        result = {}
        for setting in settings:
            result[setting.key] = AppSettingsRepository.get_setting(session, setting.key)
        return result


class LLMProviderRepository:
    """LLM提供商数据访问类"""

    @staticmethod
    def get_all(session: Session, enabled_only: bool = False) -> list[LLMProvider]:
        """
        获取所有提供商

        Args:
            session: 数据库会话
            enabled_only: 是否只返回启用的提供商

        Returns:
            提供商列表
        """
        query = session.query(LLMProvider)
        if enabled_only:
            query = query.filter(LLMProvider.enabled == True)
        return query.order_by(LLMProvider.name.asc()).all()

    @staticmethod
    def get_by_id(session: Session, provider_id: int) -> Optional[LLMProvider]:
        """
        根据ID获取提供商

        Args:
            session: 数据库会话
            provider_id: 提供商ID

        Returns:
            提供商对象或None
        """
        return session.query(LLMProvider).filter(LLMProvider.id == provider_id).first()

    @staticmethod
    def create(session: Session, name: str, api_key: str, api_base: str, 
               llm_model: str, embedding_model: str = None, enabled: bool = True) -> LLMProvider:
        """
        创建新提供商

        Args:
            session: 数据库会话
            name: 提供商名称
            api_key: API密钥
            api_base: API基础URL
            llm_model: 大模型名称
            embedding_model: 向量模型名称（可选）
            enabled: 是否启用

        Returns:
            创建的提供商对象
        """
        provider = LLMProvider(
            name=name,
            api_key=api_key,
            api_base=api_base,
            llm_model=llm_model,
            embedding_model=embedding_model,
            enabled=enabled
        )
        session.add(provider)
        session.commit()
        session.refresh(provider)
        return provider

    @staticmethod
    def update(session: Session, provider_id: int, name: str = None, api_key: str = None,
               api_base: str = None, llm_model: str = None, embedding_model: str = None,
               enabled: bool = None) -> Optional[LLMProvider]:
        """
        更新提供商

        Args:
            session: 数据库会话
            provider_id: 提供商ID
            name: 提供商名称（可选）
            api_key: API密钥（可选）
            api_base: API基础URL（可选）
            llm_model: 大模型名称（可选）
            embedding_model: 向量模型名称（可选）
            enabled: 是否启用（可选）

        Returns:
            更新后的提供商对象或None
        """
        provider = session.query(LLMProvider).filter(LLMProvider.id == provider_id).first()
        if not provider:
            return None

        if name is not None:
            provider.name = name
        if api_key is not None:
            provider.api_key = api_key
        if api_base is not None:
            provider.api_base = api_base
        if llm_model is not None:
            provider.llm_model = llm_model
        if embedding_model is not None:
            provider.embedding_model = embedding_model
        if enabled is not None:
            provider.enabled = enabled

        session.commit()
        session.refresh(provider)
        return provider

    @staticmethod
    def delete(session: Session, provider_id: int) -> bool:
        """
        删除提供商

        Args:
            session: 数据库会话
            provider_id: 提供商ID

        Returns:
            是否删除成功
        """
        provider = session.query(LLMProvider).filter(LLMProvider.id == provider_id).first()
        if provider:
            session.delete(provider)
            session.commit()
            return True
        return False

    @staticmethod
    def get_enabled_with_embedding(session: Session) -> list[LLMProvider]:
        """
        获取已启用且支持向量模型的提供商

        Args:
            session: 数据库会话

        Returns:
            提供商列表
        """
        return session.query(LLMProvider).filter(
            LLMProvider.enabled == True,
            LLMProvider.embedding_model.isnot(None),
            LLMProvider.embedding_model != ""
        ).order_by(LLMProvider.name.asc()).all()
