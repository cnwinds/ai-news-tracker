"""
统一数据采集服务
"""
import json
from datetime import datetime, timedelta
from typing import List, Dict, Any
from pathlib import Path
import logging
from time import sleep
from concurrent.futures import ThreadPoolExecutor, as_completed

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

        # 3. AI分析（按时间从新到旧，只分析最近3天的文章）
        if enable_ai_analysis and self.ai_analyzer:
            logger.info("\n🤖 开始AI分析（按时间从新到旧，只分析最近3天的文章）")
            ai_stats = self._analyze_articles(db, batch_size=50, max_age_days=3, max_workers=3)
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

    def _fetch_articles_full_content(self, articles: List[Dict[str, Any]], source_name: str, max_workers: int = 3) -> List[Dict[str, Any]]:
        """
        并发获取文章的完整内容
        
        Args:
            articles: 文章列表
            source_name: 源名称
            max_workers: 最大并发数，默认3（避免对单个网站压力过大）
        
        Returns:
            更新后的文章列表
        """
        # 筛选需要获取完整内容的文章（blog文章）
        articles_to_fetch = [
            article for article in articles 
            if article.get("category") == "rss" and article.get("url")
        ]
        
        if not articles_to_fetch:
            return articles
        
        logger.info(f"  📄 开始并发获取 {len(articles_to_fetch)} 篇文章的完整内容（最大并发数: {max_workers}）")
        
        # 并发获取完整内容
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # 提交所有任务
            future_to_article = {
                executor.submit(self.rss_collector.fetch_full_content, article["url"]): article
                for article in articles_to_fetch
            }
            
            # 收集结果
            completed = 0
            for future in as_completed(future_to_article):
                article = future_to_article[future]
                completed += 1
                
                try:
                    full_content = future.result()
                    if full_content:
                        article["content"] = full_content
                        logger.info(f"  ✅ [{completed}/{len(articles_to_fetch)}] 已获取完整内容: {article['title'][:50]}...")
                    else:
                        logger.warning(f"  ⚠️  [{completed}/{len(articles_to_fetch)}] 无法获取完整内容，使用RSS摘要: {article['title'][:50]}...")
                except Exception as e:
                    logger.warning(f"  ⚠️  [{completed}/{len(articles_to_fetch)}] 获取完整内容失败: {article['title'][:50]}... - {e}")
        
        logger.info(f"  ✅ 完整内容获取完成: {len(articles_to_fetch)} 篇文章")
        return articles

    def _fix_source_by_feed_title(self, db, session, feed_title: str, correct_source_name: str):
        """
        根据feed title修正数据库中文章的source字段
        
        Args:
            db: 数据库管理器
            session: 数据库会话
            feed_title: RSS feed的title
            correct_source_name: 正确的订阅源名称
        """
        try:
            # 查找source字段等于feed_title的文章
            articles_to_fix = session.query(Article).filter(
                Article.source == feed_title
            ).all()
            
            if articles_to_fix:
                fixed_count = 0
                for article in articles_to_fix:
                    article.source = correct_source_name
                    fixed_count += 1
                
                session.commit()
                logger.info(f"  🔧 已修正 {fixed_count} 篇文章的source字段: '{feed_title}' -> '{correct_source_name}'")
        except Exception as e:
            logger.warning(f"  ⚠️  修正source字段失败: {e}")
            session.rollback()

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
            for source_name, feed_result in results.items():
                try:
                    articles = feed_result.get("articles", [])
                    feed_title = feed_result.get("feed_title")
                    
                    # 如果feed title与订阅源名称不一致，修正数据库中已有的文章
                    if feed_title and feed_title != source_name:
                        self._fix_source_by_feed_title(db, session, feed_title, source_name)
                    
                    # 确保使用正确的source名称
                    for article in articles:
                        article["source"] = source_name
                    
                    # 并发获取完整内容（仅对blog文章）
                    articles_with_full_content = self._fetch_articles_full_content(
                        articles, source_name, max_workers=3
                    )
                    
                    # 保存文章
                    new_count = 0
                    for article in articles_with_full_content:
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
                # 对于完整内容，不限制长度（使用Text类型可以存储大量文本）
                content = article.get("content", "")
                new_article = Article(
                    title=article.get("title"),
                    url=article.get("url"),
                    content=content,  # 不限制长度，使用Text类型
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

    def _analyze_articles(self, db, batch_size: int = 50, max_age_days: int = 3, max_workers: int = 3) -> Dict[str, Any]:
        """
        AI分析未分析的文章（并发）
        
        Args:
            batch_size: 批次大小
            max_age_days: 最大文章年龄（天数），超过此天数的文章不分析，默认3天
            max_workers: 最大并发数，默认3
        """
        stats = {"analyzed_count": 0, "analysis_error": 0, "skipped_old": 0}

        with db.get_session() as session:
            # 计算时间阈值（只分析最近max_age_days天的文章）
            from datetime import timedelta
            time_threshold = datetime.now() - timedelta(days=max_age_days)
            
            # 获取未分析的文章（只分析最近的文章）
            unanalyzed = (
                session.query(Article)
                .filter(
                    Article.is_processed == False,
                    Article.published_at.isnot(None),
                    Article.published_at >= time_threshold
                )
                .order_by(Article.published_at.desc())
                .limit(batch_size)
                .all()
            )
            
            # 统计跳过的旧文章
            skipped_count = (
                session.query(Article)
                .filter(
                    Article.is_processed == False,
                    Article.published_at.isnot(None),
                    Article.published_at < time_threshold
                )
                .count()
            )
            stats["skipped_old"] = skipped_count

            if not unanalyzed:
                if skipped_count > 0:
                    logger.info(f"  ✅ 没有需要AI分析的文章（跳过了 {skipped_count} 篇超过 {max_age_days} 天的旧文章）")
                else:
                    logger.info("  ✅ 没有需要AI分析的文章")
                return stats

            logger.info(f"  🤖 开始并发分析 {len(unanalyzed)} 篇文章（按时间从新到旧排序，最大并发数: {max_workers}，跳过了 {skipped_count} 篇超过 {max_age_days} 天的旧文章）")
            
            # 显示将要分析的文章时间范围
            if unanalyzed:
                latest_date = unanalyzed[0].published_at
                oldest_date = unanalyzed[-1].published_at
                if latest_date and oldest_date:
                    logger.info(f"  📅 分析时间范围: {oldest_date.strftime('%Y-%m-%d')} 至 {latest_date.strftime('%Y-%m-%d')}")

            # 预先加载所有属性，避免在并发时出现DetachedInstanceError
            for article in unanalyzed:
                _ = article.id
                _ = article.title
                _ = article.content
                _ = article.source
                _ = article.published_at
            
            session.expunge_all()

            # 并发分析文章
            def analyze_single_article(article):
                """分析单篇文章（用于并发执行）"""
                try:
                    # 为每个线程创建独立的数据库会话
                    with db.get_session() as article_session:
                        # 重新查询文章（避免DetachedInstanceError）
                        article_obj = article_session.query(Article).filter(Article.id == article.id).first()
                        if not article_obj or article_obj.is_processed:
                            return {"success": False, "reason": "already_processed"}
                        
                        # 准备文章数据
                        article_dict = {
                            "title": article_obj.title,
                            "content": article_obj.content,
                            "source": article_obj.source,
                            "published_at": article_obj.published_at,
                        }

                        # AI分析
                        result = self.ai_analyzer.analyze_article(article_dict)

                        # 更新文章
                        article_obj.summary = result.get("summary")
                        article_obj.topics = result.get("topics")
                        article_obj.tags = result.get("tags")
                        article_obj.importance = result.get("importance")
                        article_obj.target_audience = result.get("target_audience")
                        article_obj.key_points = result.get("key_points")
                        article_obj.is_processed = True

                        article_session.commit()
                        return {"success": True, "article_id": article_obj.id}
                        
                except Exception as e:
                    logger.error(f"  ❌ 分析文章失败 (ID={article.id}): {e}")
                    return {"success": False, "error": str(e)}

            # 使用线程池并发分析
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_article = {
                    executor.submit(analyze_single_article, article): article
                    for article in unanalyzed
                }
                
                completed = 0
                for future in as_completed(future_to_article):
                    article = future_to_article[future]
                    completed += 1
                    
                    try:
                        result = future.result()
                        if result.get("success"):
                            stats["analyzed_count"] += 1
                            if completed % 5 == 0 or completed == len(unanalyzed):
                                logger.info(f"  ✅ [{completed}/{len(unanalyzed)}] AI分析进度")
                        else:
                            stats["analysis_error"] += 1
                    except Exception as e:
                        logger.error(f"  ❌ 分析文章异常 (ID={article.id}): {e}")
                        stats["analysis_error"] += 1

        logger.info(f"  ✅ AI分析完成: {stats['analyzed_count']} 篇成功, {stats['analysis_error']} 篇失败")
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
