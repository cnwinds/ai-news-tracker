"""
统一数据采集服务
"""
import json
from datetime import datetime, timedelta
from typing import List, Dict, Any
from pathlib import Path
import logging

from sqlalchemy import desc
from sqlalchemy.orm import Session

from collector.rss_collector import RSSCollector
from collector.api_collector import ArXivCollector, HuggingFaceCollector, PapersWithCodeCollector
from database import get_db
from database.models import Article, CollectionLog, RSSSource
from analyzer.ai_analyzer import AIAnalyzer

logger = logging.getLogger(__name__)


class CollectionService:
    """统一数据采集服务"""

    def __init__(self, config_path: str = "config/sources.json", ai_analyzer: AIAnalyzer = None):
        self.ai_analyzer = ai_analyzer
        self.config = self._load_config(config_path)

        # 初始化各个采集器
        self.rss_collector = RSSCollector()
        self.arxiv_collector = ArXivCollector()
        self.hf_collector = HuggingFaceCollector()
        self.pwc_collector = PapersWithCodeCollector()

    def _load_config(self, config_path: str) -> Dict[str, Any]:
        """加载配置文件"""
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"❌ 加载配置文件失败: {e}")
            return {"rss_sources": [], "api_sources": [], "web_sources": [], "social_sources": []}

    def collect_all(self, enable_ai_analysis: bool = True, task_id: int = None) -> Dict[str, Any]:
        """
        采集所有配置的数据源

        Args:
            enable_ai_analysis: 是否启用AI分析
            task_id: 任务ID，用于实时更新任务状态

        Returns:
            采集统计信息
        """
        logger.info("🚀 开始采集所有数据源")
        stats = {
            "total_articles": 0,
            "new_articles": 0,
            "sources_success": 0,
            "sources_error": 0,
            "start_time": datetime.now(),
        }

        db = get_db()

        # 1. 采集RSS源
        logger.info("\n📡 采集RSS源")
        rss_stats = self._collect_rss_sources(db, task_id=task_id)
        stats.update(rss_stats)
        
        # 实时更新任务状态
        if task_id:
            self._update_task_progress(db, task_id, stats)

        # 2. 采集API源（arXiv, Hugging Face等）
        logger.info("\n📚 采集论文API源")
        api_stats = self._collect_api_sources(db, task_id=task_id)
        stats.update(api_stats)
        
        # 实时更新任务状态
        if task_id:
            self._update_task_progress(db, task_id, stats)

        # 3. AI分析
        if enable_ai_analysis and self.ai_analyzer:
            logger.info("\n🤖 开始AI分析")
            ai_stats = self._analyze_articles(db)
            stats.update(ai_stats)
            
            # 实时更新任务状态
            if task_id:
                self._update_task_progress(db, task_id, stats)

        stats["end_time"] = datetime.now()
        stats["duration"] = (stats["end_time"] - stats["start_time"]).total_seconds()

        logger.info(f"\n✅ 采集完成！")
        logger.info(f"   总文章数: {stats['total_articles']}")
        logger.info(f"   新增文章: {stats['new_articles']}")
        logger.info(f"   成功源数: {stats['sources_success']}")
        logger.info(f"   耗时: {stats['duration']:.2f}秒")

        return stats

    def _update_task_progress(self, db, task_id: int, stats: Dict[str, Any]):
        """更新任务进度"""
        try:
            from database.models import CollectionTask
            with db.get_session() as session:
                task = session.query(CollectionTask).filter(CollectionTask.id == task_id).first()
                if task:
                    task.new_articles_count = stats.get('new_articles', 0)
                    task.total_sources = stats.get('sources_success', 0) + stats.get('sources_error', 0)
                    task.success_sources = stats.get('sources_success', 0)
                    task.failed_sources = stats.get('sources_error', 0)
                    task.ai_analyzed_count = stats.get('analyzed_count', 0)
                    session.commit()
        except Exception as e:
            logger.error(f"❌ 更新任务进度失败: {e}")

    def _collect_rss_sources(self, db, task_id: int = None) -> Dict[str, Any]:
        """采集RSS源（优先从数据库读取，兼容配置文件）"""
        stats = {"sources_success": 0, "sources_error": 0, "new_articles": 0, "total_articles": 0}

        # 优先从数据库读取RSS源
        rss_configs = []
        with db.get_session() as session:
            db_sources = session.query(RSSSource).filter(RSSSource.enabled == True).order_by(RSSSource.priority.asc()).all()
            
            for source in db_sources:
                rss_configs.append({
                    "name": source.name,
                    "url": source.url,
                    "enabled": source.enabled,
                    "max_articles": 20,  # 默认值
                    "category": source.category,
                    "tier": source.tier,
                })
                # 预先加载属性
                _ = source.id
                _ = source.name
                _ = source.url
                _ = source.enabled
                _ = source.last_collected_at
                _ = source.articles_count
            session.expunge_all()
        
        # 如果数据库中没有源，则从配置文件读取（向后兼容）
        if not rss_configs:
            logger.info("  ℹ️  数据库中没有RSS源，从配置文件读取")
            rss_configs = self.config.get("rss_sources", [])
        
        if not rss_configs:
            logger.warning("  ⚠️  没有配置RSS源")
            return stats

        results = self.rss_collector.fetch_multiple_feeds(rss_configs)

        # 更新数据库中的统计信息
        with db.get_session() as session:
            for source_name, articles in results.items():
                try:
                    new_count = 0
                    for article in articles:
                        if self._save_article(db, article):
                            new_count += 1

                    # 更新RSS源的统计信息
                    source_obj = session.query(RSSSource).filter(RSSSource.name == source_name).first()
                    if source_obj:
                        source_obj.last_collected_at = datetime.now()
                        source_obj.articles_count += len(articles)
                        source_obj.last_error = None
                        session.commit()

                    # 记录日志
                    self._log_collection(db, source_name, "rss", "success", len(articles))
                    stats["sources_success"] += 1
                    stats["new_articles"] += new_count
                    stats["total_articles"] += len(articles)

                    logger.info(f"  ✅ {source_name}: {len(articles)} 篇, 新增 {new_count} 篇")

                except Exception as e:
                    logger.error(f"  ❌ {source_name}: {e}")
                    
                    # 更新错误信息
                    source_obj = session.query(RSSSource).filter(RSSSource.name == source_name).first()
                    if source_obj:
                        source_obj.last_error = str(e)
                        session.commit()
                    
                    self._log_collection(db, source_name, "rss", "error", 0, str(e))
                    stats["sources_error"] += 1

        return stats

    def _collect_api_sources(self, db, task_id: int = None) -> Dict[str, Any]:
        """采集API源"""
        stats = {"sources_success": 0, "sources_error": 0, "new_articles": 0, "total_articles": 0}

        api_configs = self.config.get("api_sources", [])

        for config in api_configs:
            if not config.get("enabled", True):
                continue

            name = config.get("name")
            source_type = config.get("category")

            try:
                articles = []
                if "arxiv" in name.lower():
                    query = config.get("query")
                    max_results = config.get("max_results", 20)
                    articles = self.arxiv_collector.fetch_papers(query, max_results)

                elif "hugging Face" in name.lower():
                    limit = config.get("max_results", 20)
                    articles = self.hf_collector.fetch_trending_papers(limit)

                elif "papers with code" in name.lower():
                    limit = config.get("max_results", 20)
                    articles = self.pwc_collector.fetch_trending_papers(limit)

                # 保存文章
                new_count = 0
                for article in articles:
                    if self._save_article(db, article):
                        new_count += 1

                # 记录日志
                self._log_collection(db, name, "api", "success", len(articles))
                stats["sources_success"] += 1
                stats["new_articles"] += new_count
                stats["total_articles"] += len(articles)

                logger.info(f"  ✅ {name}: {len(articles)} 篇, 新增 {new_count} 篇")

            except Exception as e:
                logger.error(f"  ❌ {name}: {e}")
                self._log_collection(db, name, "api", "error", 0, str(e))
                stats["sources_error"] += 1

        return stats

    def _save_article(self, db, article: Dict[str, Any]) -> bool:
        """
        保存文章到数据库

        Returns:
            True if new article, False if already exists
        """
        try:
            with db.get_session() as session:
                # 检查是否已存在
                existing = session.query(Article).filter(Article.url == article["url"]).first()

                if existing:
                    return False

                # 创建新文章
                new_article = Article(
                    title=article.get("title"),
                    url=article.get("url"),
                    content=article.get("content", "")[:10000],  # 限制长度
                    source=article.get("source"),
                    category=article.get("category"),
                    author=article.get("author"),
                    published_at=article.get("published_at"),
                    extra_data=article.get("metadata"),
                )

                session.add(new_article)
                session.commit()

                return True

        except Exception as e:
            logger.error(f"❌ 保存文章失败: {e}")
            return False

    def _analyze_articles(self, db, batch_size: int = 50) -> Dict[str, Any]:
        """AI分析未分析的文章"""
        stats = {"analyzed_count": 0, "analysis_error": 0}

        with db.get_session() as session:
            # 获取未分析的文章
            unanalyzed = (
                session.query(Article).filter(Article.is_processed == False).order_by(Article.published_at.desc()).limit(batch_size).all()
            )

            if not unanalyzed:
                logger.info("  ✅ 没有需要AI分析的文章")
                return stats

            logger.info(f"  🤖 开始分析 {len(unanalyzed)} 篇文章")

            for article in unanalyzed:
                try:
                    # 准备文章数据
                    article_dict = {
                        "title": article.title,
                        "content": article.content,
                        "source": article.source,
                        "published_at": article.published_at,
                    }

                    # AI分析
                    result = self.ai_analyzer.analyze_article(article_dict)

                    # 更新文章
                    article.summary = result.get("summary")
                    article.topics = result.get("topics")
                    article.tags = result.get("tags")
                    article.importance = result.get("importance")
                    article.target_audience = result.get("target_audience")
                    article.key_points = result.get("key_points")
                    article.is_processed = True

                    stats["analyzed_count"] += 1

                except Exception as e:
                    logger.error(f"  ❌ 分析文章失败 (ID={article.id}): {e}")
                    stats["analysis_error"] += 1

            session.commit()

        logger.info(f"  ✅ AI分析完成: {stats['analyzed_count']} 篇")
        return stats

    def _log_collection(self, db, source_name: str, source_type: str, status: str, count: int, error: str = None):
        """记录采集日志"""
        try:
            with db.get_session() as session:
                log = CollectionLog(
                    source_name=source_name,
                    source_type=source_type,
                    status=status,
                    articles_count=count,
                    error_message=error,
                )
                session.add(log)
                session.commit()
        except Exception as e:
            logger.error(f"❌ 记录日志失败: {e}")

    def get_recent_articles(self, db, limit: int = 100, hours: int = 24) -> List[Article]:
        """获取最近的文章"""
        with db.get_session() as session:
            time_threshold = datetime.now() - timedelta(hours=hours)

            articles = (
                session.query(Article)
                .filter(Article.published_at >= time_threshold)
                .order_by(desc(Article.published_at))
                .limit(limit)
                .all()
            )

            return articles

    def get_daily_summary(self, db, limit: int = 10) -> List[Article]:
        """获取每日重要文章"""
        with db.get_session() as session:
            time_threshold = datetime.now() - timedelta(hours=24)

            articles = (
                session.query(Article)
                .filter(Article.published_at >= time_threshold, Article.importance.in_(["high", "medium"]))
                .order_by(desc(Article.published_at))
                .limit(limit)
                .all()
            )

            return articles
