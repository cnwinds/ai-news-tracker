"""
统一数据采集服务
"""
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Union

from backend.app.db import get_db
from backend.app.db.models import Article, CollectionLog, RSSSource
from backend.app.services.analyzer.ai_analyzer import AIAnalyzer
from backend.app.services.collector.api_collector import (
    ArXivCollector,
    HuggingFaceCollector,
    PapersWithCodeCollector,
)
from backend.app.services.collector.email_collector import EmailCollector
from backend.app.services.collector.rss_collector import RSSCollector
from backend.app.services.collector.twitter_collector import TwitterCollector
from backend.app.services.collector.base_collector import BaseCollector
from backend.app.services.collector.types import (
    ArticleDict,
    CollectorConfig,
    CollectionStats,
    SourceProcessStats,
)
from backend.app.services.collector.web_collector import WebCollector

logger = logging.getLogger(__name__)


class CollectionService:
    """统一数据采集服务"""

    def __init__(self, ai_analyzer: AIAnalyzer = None):
        # 数据采集只从数据库读取源
        # 配置文件仅用于导入功能，不用于采集
        self.ai_analyzer = ai_analyzer

        # 初始化各个采集器
        self.rss_collector = RSSCollector()
        self.arxiv_collector = ArXivCollector()
        self.hf_collector = HuggingFaceCollector()
        self.pwc_collector = PapersWithCodeCollector()
        self.web_collector = WebCollector()
        self.twitter_collector = TwitterCollector()
        self.email_collector = EmailCollector()

        # 初始化总结生成器
        if ai_analyzer:
            from backend.app.services.collector.summary_generator import SummaryGenerator
            self.summary_generator = SummaryGenerator(ai_analyzer)
        else:
            self.summary_generator = None

    @staticmethod
    def _parse_json_safely(json_str: Union[str, dict, None]) -> dict:
        """
        安全地解析JSON字符串
        
        Args:
            json_str: JSON字符串或字典
            
        Returns:
            解析后的字典，如果解析失败则返回空字典
        """
        if json_str is None:
            return {}
        if isinstance(json_str, dict):
            return json_str
        if isinstance(json_str, str):
            try:
                return json.loads(json_str)
            except (json.JSONDecodeError, TypeError, ValueError):
                return {}
        return {}

    @staticmethod
    def _create_empty_stats() -> CollectionStats:
        """
        创建空的统计信息字典
        
        Returns:
            初始化的统计信息字典
        """
        return {
            "total_articles": 0,
            "new_articles": 0,
            "sources_success": 0,
            "sources_error": 0,
            "start_time": datetime.now(),
        }

    def _merge_extra_config(self, config: CollectorConfig) -> CollectorConfig:
        """
        合并 extra_config 到主配置中
        
        Args:
            config: 源配置字典
            
        Returns:
            合并后的配置字典
        """
        merged_config = config.copy()
        extra_config = self._parse_json_safely(config.get("extra_config"))
        
        if extra_config:
            # 将 extra_config 中的字段合并到主配置
            merged_config.update(extra_config)
        
        return merged_config

    def _get_collector_by_type(
        self, 
        source_type: str, 
        sub_type: Optional[str] = None
    ) -> tuple[Optional[BaseCollector], Optional[str]]:
        """
        根据source_type和sub_type获取对应的采集器
        
        Args:
            source_type: 源类型（rss/api/web/email）
            sub_type: 源子类型（如api下的arxiv/huggingface/paperswithcode，social下的twitter/reddit/hackernews）
        
        Returns:
            (collector_instance, collector_name) 元组，如果找不到则返回(None, None)
        """
        # 根据source_type和sub_type选择采集器
        if source_type == "rss":
            return (self.rss_collector, "rss")
        
        elif source_type == "api":
            if sub_type == "arxiv":
                return (self.arxiv_collector, "arxiv")
            elif sub_type == "huggingface":
                return (self.hf_collector, "huggingface")
            elif sub_type == "paperswithcode":
                return (self.pwc_collector, "paperswithcode")
            elif sub_type == "twitter":
                return (self.twitter_collector, "twitter")
            else:
                return (None, None)
        
        elif source_type == "web":
            return (self.web_collector, "web")
        
        elif source_type == "email":
            return (self.email_collector, "email")
        
        return (None, None)

    def collect_all(
        self, 
        enable_ai_analysis: bool = True, 
        task_id: Optional[int] = None
    ) -> CollectionStats:
        """
        采集所有配置的数据源

        Args:
            enable_ai_analysis: 是否启用AI分析
            task_id: 任务ID，用于实时更新任务状态

        Returns:
            采集统计信息
        """
        logger.info("🚀 开始采集所有数据源")
        
        db = get_db()
        
        # 在开始采集前，检查并恢复挂起的任务
        self._recover_stuck_tasks(db)
        
        # 导入停止检查函数
        from backend.app.api.v1.endpoints.collection import is_stop_requested
        
        stats = self._create_empty_stats()

        # 1. 采集RSS源（双层并发：多个RSS源 + 每个源内部并发获取内容+AI分析）
        logger.info("\n📡 采集RSS源（双层并发模式）")
        if task_id and is_stop_requested(task_id):
            logger.info("🛑 收到停止信号，终止采集")
            return stats
        rss_stats = self._collect_rss_sources(db, task_id=task_id, enable_ai_analysis=enable_ai_analysis)
        stats["total_articles"] += rss_stats.get("total_articles", 0)
        stats["new_articles"] += rss_stats.get("new_articles", 0)
        stats["sources_success"] += rss_stats.get("sources_success", 0)
        stats["sources_error"] += rss_stats.get("sources_error", 0)
        stats["ai_analyzed_count"] = rss_stats.get("ai_analyzed_count", 0)

        # 实时更新任务状态
        if task_id:
            self._update_task_progress(db, task_id, stats)
            if is_stop_requested(task_id):
                logger.info("🛑 收到停止信号，终止采集")
                return stats

        # 2. 采集API源（arXiv, Hugging Face等）
        logger.info("\n📚 采集论文API源")
        if task_id and is_stop_requested(task_id):
            logger.info("🛑 收到停止信号，终止采集")
            return stats
        api_stats = self._collect_api_sources(db, task_id=task_id, enable_ai_analysis=enable_ai_analysis)
        stats["total_articles"] += api_stats.get("total_articles", 0)
        stats["new_articles"] += api_stats.get("new_articles", 0)
        stats["sources_success"] += api_stats.get("sources_success", 0)
        stats["sources_error"] += api_stats.get("sources_error", 0)
        stats["ai_analyzed_count"] += api_stats.get("ai_analyzed_count", 0)

        # 实时更新任务状态
        if task_id:
            self._update_task_progress(db, task_id, stats)
            if is_stop_requested(task_id):
                logger.info("🛑 收到停止信号，终止采集")
                return stats

        # 3. 采集网站源（通过网页爬取）
        logger.info("\n🌐 采集网站源")
        if task_id and is_stop_requested(task_id):
            logger.info("🛑 收到停止信号，终止采集")
            return stats
        web_stats = self._collect_web_sources(db, task_id=task_id, enable_ai_analysis=enable_ai_analysis)
        stats["total_articles"] += web_stats.get("total_articles", 0)
        stats["new_articles"] += web_stats.get("new_articles", 0)
        stats["sources_success"] += web_stats.get("sources_success", 0)
        stats["sources_error"] += web_stats.get("sources_error", 0)
        stats["ai_analyzed_count"] += web_stats.get("ai_analyzed_count", 0)

        # 实时更新任务状态
        if task_id:
            self._update_task_progress(db, task_id, stats)
            if is_stop_requested(task_id):
                logger.info("🛑 收到停止信号，终止采集")
                return stats

        # 3. 采集邮件源
        logger.info("\n📧 采集邮件源")
        if task_id and is_stop_requested(task_id):
            logger.info("🛑 收到停止信号，终止采集")
            return stats
        email_stats = self._collect_email_sources(db, task_id=task_id, enable_ai_analysis=enable_ai_analysis)
        stats["total_articles"] += email_stats.get("total_articles", 0)
        stats["new_articles"] += email_stats.get("new_articles", 0)
        stats["sources_success"] += email_stats.get("sources_success", 0)
        stats["sources_error"] += email_stats.get("sources_error", 0)
        stats["ai_analyzed_count"] += email_stats.get("ai_analyzed_count", 0)

        # 实时更新任务状态
        if task_id:
            self._update_task_progress(db, task_id, stats)
            if is_stop_requested(task_id):
                logger.info("🛑 收到停止信号，终止采集")
                return stats

        # 6. 可选：自动索引新文章到RAG库
        if enable_ai_analysis and self.ai_analyzer:
            try:
                logger.info("\n🔍 开始自动索引新文章到RAG库...")
                from backend.app.services.rag.rag_service import RAGService
                from backend.app.db.models import ArticleEmbedding
                with db.get_session() as session:
                    rag_service = RAGService(ai_analyzer=self.ai_analyzer, db=session)
                    # 获取所有未索引的文章（不限制时间，避免遗漏）
                    # 使用子查询排除已索引的文章
                    from sqlalchemy import select
                    indexed_ids = select(ArticleEmbedding.article_id)
                    unindexed_articles = session.query(Article).filter(
                        ~Article.id.in_(indexed_ids)
                    ).all()
                    
                    if unindexed_articles:
                        logger.info(f"📝 找到 {len(unindexed_articles)} 篇未索引文章，开始索引...")
                        index_result = rag_service.index_articles_batch(unindexed_articles, batch_size=10)
                        stats["rag_indexed"] = index_result.get("success", 0)
                        logger.info(f"✅ RAG索引完成: 成功 {index_result.get('success', 0)} 篇，失败 {index_result.get('failed', 0)} 篇")
                    else:
                        logger.info("ℹ️  所有文章已索引")
                        stats["rag_indexed"] = 0
            except Exception as e:
                logger.warning(f"⚠️  自动索引失败（不影响采集流程）: {e}")
                stats["rag_indexed"] = 0

        try:
            from backend.app.core.settings import settings
            from backend.app.services.knowledge_graph import KnowledgeGraphService

            settings.load_settings_from_db(force_reload=True)
            if settings.KNOWLEDGE_GRAPH_ENABLED and settings.KNOWLEDGE_GRAPH_AUTO_SYNC_ENABLED:
                logger.info("\n[KG] Starting automatic knowledge graph sync...")
                with db.get_session() as session:
                    from backend.app.utils.factories import create_knowledge_graph_ai_analyzer

                    kg_service = KnowledgeGraphService(
                        db=session,
                        ai_analyzer=create_knowledge_graph_ai_analyzer(),
                    )
                    kg_result = kg_service.sync_articles(
                        force_rebuild=False,
                        sync_mode=settings.get_knowledge_graph_run_mode(),
                        max_articles=settings.KNOWLEDGE_GRAPH_MAX_ARTICLES_PER_SYNC,
                        trigger_source="collection",
                    )
                    build = kg_result.get("build") or {}
                    stats["knowledge_graph_synced"] = build.get("processed_articles", 0)
                    stats["knowledge_graph_skipped"] = build.get("skipped_articles", 0)
                    logger.info(
                        "[KG] Sync completed: processed=%s skipped=%s",
                        stats["knowledge_graph_synced"],
                        stats["knowledge_graph_skipped"],
                    )
            else:
                stats["knowledge_graph_synced"] = 0
                stats["knowledge_graph_skipped"] = 0
        except Exception as e:
            logger.warning("[KG] Automatic sync failed but collection will continue: %s", e)
            stats["knowledge_graph_synced"] = 0
            stats["knowledge_graph_skipped"] = 0

        stats["end_time"] = datetime.now()
        stats["duration"] = (stats["end_time"] - stats["start_time"]).total_seconds()

        logger.info(f"\n✅ 采集完成！")
        logger.info(f"   总文章数: {stats['total_articles']}")
        logger.info(f"   新增文章: {stats['new_articles']}")
        logger.info(f"   成功源数: {stats['sources_success']}")
        logger.info(f"   失败源数: {stats['sources_error']}")
        logger.info(f"   AI分析数: {stats.get('ai_analyzed_count', 0)}")
        logger.info(f"   耗时: {stats['duration']:.2f}秒")

        return stats

    def _fetch_articles_full_content(
        self, 
        articles: List[ArticleDict], 
        source_name: str, 
        max_workers: int = 3
    ) -> List[ArticleDict]:
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
                    full_content, published_at = future.result()
                    if full_content:
                        article["content"] = full_content
                        # 如果从页面提取到了日期，更新文章的published_at字段
                        if published_at:
                            article["published_at"] = published_at
                            logger.info(f"  ✅ [{completed}/{len(articles_to_fetch)}] 已获取完整内容和日期: {article['title'][:50]}...")
                        else:
                            logger.info(f"  ✅ [{completed}/{len(articles_to_fetch)}] 已获取完整内容: {article['title'][:50]}...")
                    else:
                        logger.warning(f"  ⚠️  [{completed}/{len(articles_to_fetch)}] 无法获取完整内容，使用RSS摘要: {article['title'][:50]}...")
                except Exception as e:
                    logger.warning(f"  ⚠️  [{completed}/{len(articles_to_fetch)}] 获取完整内容失败: {article['title'][:50]}... - {e}")
        
        logger.info(f"  ✅ 完整内容获取完成: {len(articles_to_fetch)} 篇文章")
        return articles

    def _update_task_progress(self, db, task_id: int, stats: CollectionStats) -> None:
        """更新任务进度"""
        try:
            from backend.app.db.models import CollectionTask
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

    def _process_single_rss_source(
        self, 
        db, 
        source_name: str, 
        feed_result: Dict[str, Union[str, int, List[ArticleDict]]], 
        enable_ai_analysis: bool = False, 
        task_id: Optional[int] = None
    ) -> SourceProcessStats:
        """
        处理单个RSS源：获取完整内容 -> 保存文章 -> AI分析（全流程并发）

        Args:
            db: 数据库管理器
            source_name: 订阅源名称
            feed_result: RSS采集结果
            enable_ai_analysis: 是否启用AI分析
            task_id: 任务ID

        Returns:
            处理结果统计
        """
        result_stats: SourceProcessStats = {
            "source_name": source_name,
            "total_articles": 0,
            "new_articles": 0,
            "skipped_articles": 0,  # 已存在的文章
            "ai_analyzed": 0,
            "ai_skipped": 0,  # 已分析的文章
            "success": False,
            "error": None,
        }

        try:
            articles = feed_result.get("articles", [])
            feed_title = feed_result.get("feed_title")

            if not articles:
                # 即使没有文章，也要记录日志（成功但无文章）
                self._log_collection(db, source_name, "rss", "success", 0, task_id=task_id)
                result_stats["success"] = True
                return result_stats

            # 确保所有文章的source字段都是订阅源名称，并设置正确的author
            # 这是关键的防御性检查：强制覆盖所有文章的source字段，防止并发冲突
            from backend.app.services.collector.rss_collector import _get_author_from_source
            from backend.app.core.settings import settings
            
            # 应用文章年龄过滤（如果配置了）
            filtered_articles = []
            skipped_old_count = 0
            max_article_age_days = settings.MAX_ARTICLE_AGE_DAYS
            
            if max_article_age_days > 0:
                age_threshold = datetime.now() - timedelta(days=max_article_age_days)
                for article in articles:
                    published_at = article.get("published_at")
                    if published_at and published_at < age_threshold:
                        skipped_old_count += 1
                        continue
                    filtered_articles.append(article)
                articles = filtered_articles
                if skipped_old_count > 0:
                    logger.info(f"  ⏭️  {source_name}: 跳过了 {skipped_old_count} 篇超过 {max_article_age_days} 天的旧文章")
            
            for article in articles:
                # 强制设置source字段，确保使用正确的订阅源名称
                # 这可以防止并发时feed title被错误使用
                article["source"] = source_name
                
                # 根据源名称或URL确定正确的作者（覆盖RSS feed中可能不准确的author）
                correct_author = _get_author_from_source(source_name, article.get("url", ""))
                if correct_author:
                    article["author"] = correct_author
                
                # 防御性检查：如果文章的source与传入的source_name不一致，记录警告
                if article.get("source") != source_name:
                    logger.warning(f"  ⚠️  文章source不匹配: 期望={source_name}, 实际={article.get('source')}, URL={article.get('url', '')[:50]}")
                    article["source"] = source_name  # 强制修正

            logger.info(f"  📥 {source_name}: 开始处理 {len(articles)} 篇文章...")

            # 注意：不再需要修正source字段，因为添加了source_id外键关联
            # 保存文章时会自动根据source_name查询RSSSource获取source_id
            # 如果RSSSource.name被修改，可以通过article.rss_source.name获取最新名称

            # 第一步：批量检查哪些文章已存在且有内容、已分析
            existing_articles_data = {}
            with db.get_session() as session:
                # 查询已存在的文章（包括内容和分析状态）
                url_list = [article.get("url") for article in articles if article.get("url")]
                if url_list:
                    existing = session.query(
                        Article.url,
                        Article.content,
                        Article.is_processed
                    ).filter(Article.url.in_(url_list)).all()

                    # 存储每个URL的状态：{"url": {"has_content": bool, "is_processed": bool}}
                    for row in existing:
                        existing_articles_data[row[0]] = {
                            "has_content": bool(row[1] and row[1].strip()),  # 检查内容是否非空
                            "is_processed": row[2]
                        }

            # 第二步：分类文章
            articles_to_fetch = []  # 需要获取内容的文章
            articles_to_analyze = []  # 需要AI分析的文章
            skipped_count = 0  # 完全跳过的文章

            for article in articles:
                url = article.get("url")
                if not url:
                    continue

                if url not in existing_articles_data:
                    # 新文章，需要获取内容和AI分析
                    articles_to_fetch.append(article)
                else:
                    # 文章已存在，检查内容和分析状态
                    status = existing_articles_data[url]

                    if not status["has_content"]:
                        # 内容为空，需要重新获取
                        articles_to_fetch.append(article)

                    if not status["is_processed"]:
                        # 未分析，需要重新分析（记录URL以便后续查找ID）
                        articles_to_analyze.append(article)

                    if status["has_content"] and status["is_processed"]:
                        # 内容完整且已分析，完全跳过
                        skipped_count += 1

            result_stats["total_articles"] = len(articles)
            result_stats["skipped_articles"] = skipped_count

            fetch_count = len(articles_to_fetch)
            analyze_count = len(articles_to_analyze)

            if skipped_count > 0 or fetch_count > 0 or analyze_count > 0:
                logger.info(f"  📊 {source_name}: 跳过 {skipped_count} 篇完整文章, 需获取内容 {fetch_count} 篇, 需AI分析 {analyze_count} 篇")

            if not articles_to_fetch and not articles_to_analyze:
                logger.info(f"  ✅ {source_name}: 所有文章都已完整采集和分析")
                # 即使所有文章都已完整，也要更新统计信息和记录日志
                with db.get_session() as session:
                    source_obj = session.query(RSSSource).filter(RSSSource.name == source_name).first()
                    if source_obj:
                        source_obj.last_collected_at = datetime.now()
                        source_obj.last_error = None
                        session.commit()
                # 记录采集日志（成功但无需处理）
                self._log_collection(db, source_name, "rss", "success", len(articles), task_id=task_id)
                result_stats["success"] = True
                return result_stats

            logger.info(f"  📥 {source_name}: 获取 {len(articles_to_fetch)} 篇文章的完整内容...")

            # 第三步：并发获取完整内容（3个并发）
            articles_with_full_content = self._fetch_articles_full_content(
                articles_to_fetch, source_name, max_workers=3
            )

            # 第四步：保存或更新文章到数据库
            logger.info(f"  💾 {source_name}: 开始保存文章...")
            saved_article_ids = []
            updated_count = 0  # 更新的文章数（已有URL但补充了内容）
            new_count = 0  # 新增文章数

            for article in articles_with_full_content:
                result = self._save_or_update_article_and_get_id(db, article)
                if result:
                    # 只保存文章ID（整数），而不是整个字典
                    saved_article_ids.append(result["id"])
                    if result["is_new"]:
                        new_count += 1
                    else:
                        updated_count += 1

            result_stats["new_articles"] = new_count

            # 更新RSS源的统计信息
            with db.get_session() as session:
                source_obj = session.query(RSSSource).filter(RSSSource.name == source_name).first()
                if source_obj:
                    source_obj.last_collected_at = datetime.now()
                    source_obj.articles_count += len(articles)
                    source_obj.last_error = None

                    # 从数据库中查询该源最新的真实published_at（而不是RSS feed的更新时间）
                    latest_article = session.query(Article).filter(
                        Article.source == source_name,
                        Article.published_at.isnot(None)
                    ).order_by(Article.published_at.desc()).first()

                    if latest_article:
                        source_obj.latest_article_published_at = latest_article.published_at

                    session.commit()

            # 记录采集日志
            self._log_collection(db, source_name, "rss", "success", len(articles), task_id=task_id)

            # 第五步：如果启用AI分析，处理需要分析的文章（包括新文章和旧文章）
            if enable_ai_analysis and self.ai_analyzer and (saved_article_ids or articles_to_analyze):
                # 收集所有需要分析的文章ID（已经是整数列表）
                all_article_ids = saved_article_ids.copy()

                # 对于已有URL但未分析的文章，查询它们的ID
                if articles_to_analyze:
                    with db.get_session() as session:
                        for article in articles_to_analyze:
                            existing = session.query(Article.id).filter(Article.url == article.get("url")).first()
                            if existing:
                                all_article_ids.append(existing.id)

                # 检查哪些文章已经分析过了
                unanalyzed_ids = self._filter_unanalyzed_articles(db, all_article_ids)
                ai_skipped = len(all_article_ids) - len(unanalyzed_ids)

                if ai_skipped > 0:
                    logger.info(f"  ⏭️  {source_name}: 跳过 {ai_skipped} 篇已分析的文章")

                if unanalyzed_ids:
                    logger.info(f"  🤖 {source_name}: 开始AI分析 {len(unanalyzed_ids)} 篇文章...")
                    analyzed_count = self._analyze_articles_by_ids(db, unanalyzed_ids, max_workers=3)
                    result_stats["ai_analyzed"] = analyzed_count

                result_stats["ai_skipped"] = ai_skipped

            result_stats["success"] = True
            logger.info(f"  ✅ {source_name}: 总共 {len(articles)} 篇, 跳过 {skipped_count} 篇, 新增 {new_count} 篇, 更新 {updated_count} 篇, AI分析 {result_stats['ai_analyzed']} 篇")

        except Exception as e:
            logger.error(f"  ❌ {source_name}: {e}")
            result_stats["error"] = str(e)

            # 更新错误信息
            with db.get_session() as session:
                source_obj = session.query(RSSSource).filter(RSSSource.name == source_name).first()
                if source_obj:
                    source_obj.last_error = str(e)
                    session.commit()

            self._log_collection(db, source_name, "rss", "error", 0, str(e), task_id=task_id)

        return result_stats

    def _collect_rss_sources(
        self, 
        db, 
        task_id: Optional[int] = None, 
        enable_ai_analysis: bool = False
    ) -> CollectionStats:
        """
        采集RSS源（双层并发：多个RSS源同时采集 + 每个源内部并发获取内容+AI分析）

        Args:
            db: 数据库管理器
            task_id: 任务ID
            enable_ai_analysis: 是否在采集每个源后立即进行AI分析

        Returns:
            采集统计信息
        """
        stats: CollectionStats = {
            "sources_success": 0,
            "sources_error": 0,
            "new_articles": 0,
            "total_articles": 0,
            "ai_analyzed_count": 0,
            "start_time": datetime.now(),
        }

        # 从数据库读取RSS源（只读取source_type为rss的源）
        rss_configs = []
        from backend.app.core.settings import settings
        # 确保加载最新的配置
        settings.load_collector_settings()
        
        with db.get_session() as session:
            db_sources = session.query(RSSSource).filter(
                RSSSource.enabled == True,
                RSSSource.source_type == "rss"
            ).order_by(RSSSource.priority.asc()).all()

            for source in db_sources:
                rss_configs.append({
                    "name": source.name,
                    "url": source.url,
                    "enabled": source.enabled,
                    "max_articles": settings.MAX_ARTICLES_PER_SOURCE,  # 使用配置值
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

        # 只从数据库读取源，如果数据库中没有源则不采集
        if not rss_configs:
            logger.info("  ℹ️  数据库中没有启用的RSS源，跳过采集")
            return stats

        logger.info(f"  🚀 开始采集 {len(rss_configs)} 个RSS源（第一层并发）")

        # 第一层并发：同时采集多个RSS源
        with ThreadPoolExecutor(max_workers=5) as executor:
            # 提交所有RSS采集任务
            future_to_source = {}

            for rss_config in rss_configs:
                source_name = rss_config["name"]

                # 深拷贝配置对象，避免多线程共享引用导致的并发问题
                # 虽然默认参数捕获了引用，但如果在调用过程中修改了字典，仍有风险
                import copy
                config_copy = copy.deepcopy(rss_config)

                # 使用默认参数捕获变量的值，避免闭包陷阱
                # 这是关键的修复：通过默认参数在定义时捕获值，而不是在运行时引用变量
                def collect_single_source(config=config_copy, name=source_name, task_id_param=task_id):
                    try:
                        # 获取RSS feed（使用传入的config，确保每个线程使用正确的配置）
                        feed_data = self.rss_collector.fetch_single_feed(config)
                        
                        # 如果fetch_single_feed返回None或无效数据，记录错误日志
                        if not feed_data:
                            error_msg = f"{name}: RSS feed获取失败，返回数据为空"
                            logger.error(f"  ❌ {error_msg}")
                            self._log_collection(db, name, "rss", "error", 0, error_msg, task_id=task_id_param)
                            return {
                                "source_name": name,
                                "success": False,
                                "error": error_msg,
                                "total_articles": 0,
                                "new_articles": 0,
                                "ai_analyzed": 0,
                            }

                        # 处理这个源（包含获取完整内容、保存、AI分析）
                        # 使用传入的name，确保每个线程使用正确的源名称
                        result = self._process_single_rss_source(
                            db, name, feed_data, enable_ai_analysis, task_id=task_id_param
                        )
                        return result
                    except Exception as e:
                        logger.error(f"  ❌ {name} 采集失败: {e}")
                        # 记录失败日志（如果fetch_single_feed失败，_process_single_rss_source不会被调用，所以不会重复）
                        # 如果_process_single_rss_source内部抛出异常，它自己会记录日志，这里再记录一次会重复
                        # 但为了确保所有异常都被记录，这里也记录一次（可能会有重复，但比遗漏好）
                        self._log_collection(db, name, "rss", "error", 0, str(e), task_id=task_id_param)
                        # 更新数据库中的 last_error 字段
                        try:
                            with db.get_session() as session:
                                source_obj = session.query(RSSSource).filter(RSSSource.name == name).first()
                                if source_obj:
                                    source_obj.last_error = str(e)
                                    session.commit()
                        except Exception as e2:
                            logger.error(f"❌ 更新源错误信息失败 {name}: {e2}")
                        return {
                            "source_name": name,
                            "success": False,
                            "error": str(e),
                            "total_articles": 0,
                            "new_articles": 0,
                            "ai_analyzed": 0,
                        }

                # 提交任务到线程池
                future = executor.submit(collect_single_source)
                future_to_source[future] = source_name

            # 收集结果
            completed = 0
            for future in as_completed(future_to_source):
                source_name = future_to_source[future]
                completed += 1

                try:
                    result = future.result()

                    if result["success"]:
                        stats["sources_success"] += 1
                        stats["new_articles"] += result["new_articles"]
                        stats["total_articles"] += result["total_articles"]
                        stats["ai_analyzed_count"] += result.get("ai_analyzed", 0)
                    else:
                        stats["sources_error"] += 1
                        # 错误日志已在 collect_single_source 中打印，这里不再重复打印
                        # 只更新数据库中的 last_error 字段
                        try:
                            with db.get_session() as session:
                                source_obj = session.query(RSSSource).filter(RSSSource.name == source_name).first()
                                if source_obj:
                                    source_obj.last_error = result.get('error', '未知错误')
                                    session.commit()
                        except Exception as e:
                            logger.error(f"❌ 更新源错误信息失败 {source_name}: {e}")

                except Exception as e:
                    logger.error(f"  ❌ {source_name} 处理异常: {e}")
                    stats["sources_error"] += 1
                    # 更新数据库中的 last_error 字段
                    try:
                        with db.get_session() as session:
                            source_obj = session.query(RSSSource).filter(RSSSource.name == source_name).first()
                            if source_obj:
                                source_obj.last_error = str(e)
                                session.commit()
                    except Exception as e2:
                        logger.error(f"❌ 更新源错误信息失败 {source_name}: {e2}")

        logger.info(f"  ✅ RSS采集完成: 成功 {stats['sources_success']} 个源, 失败 {stats['sources_error']} 个源")
        logger.info(f"     总文章: {stats['total_articles']} 篇, 新增: {stats['new_articles']} 篇, AI分析: {stats['ai_analyzed_count']} 篇")

        return stats

    def _process_articles_from_source(
        self,
        db,
        articles: List[ArticleDict],
        source_name: str,
        source_type: str,
        enable_ai_analysis: bool = False,
        task_id: Optional[int] = None,
        fetch_full_content: bool = False
    ) -> CollectionStats:
        """
        统一处理文章：抓取完整内容 + 保存 + AI分析

        Args:
            db: 数据库管理器
            articles: 文章列表
            source_name: 源名称
            source_type: 源类型 (rss/api/web/social/email)
            enable_ai_analysis: 是否启用AI分析
            task_id: 任务ID
            fetch_full_content: 是否抓取完整内容（默认False）

        Returns:
            {"total": int, "new": int, "ai_analyzed": int}
        """
        if not articles:
            return {"total": 0, "new": 0, "ai_analyzed": 0}

        # 统一修正所有文章的source字段为配置中的name，确保使用正确的源名称
        for article in articles:
            article["source"] = source_name

        # 如果需要抓取完整内容
        if fetch_full_content:
            logger.info(f"  🌐 开始为文章抓取完整内容...")
            articles_with_full_content = []

            for i, article in enumerate(articles, 1):
                url = article.get("url", "")
                if not url or url.startswith("mailto:"):
                    # 没有URL或mailto链接，保留原始内容
                    articles_with_full_content.append(article)
                    continue

                try:
                    # 使用web_collector抓取完整内容
                    full_content = self.web_collector.fetch_full_content(url)

                    if full_content and len(full_content) > len(article.get("content", "")):
                        # 抓取成功：保留原始摘要作为summary，完整内容作为content
                        article["summary"] = article.get("content", "")
                        article["content"] = full_content
                        logger.debug(f"  ✅ [{i}/{len(articles)}] 抓取成功: {article.get('title', 'Unknown')[:50]}")
                    else:
                        # 抓取失败或内容更短：使用摘要作为内容
                        article["summary"] = article.get("content", "")
                        article["content"] = article.get("content", "")
                        logger.debug(f"  ⚠️  [{i}/{len(articles)}] 抓取失败或内容过短，使用摘要: {article.get('title', 'Unknown')[:50]}")

                    articles_with_full_content.append(article)

                except Exception as e:
                    logger.warning(f"  ⚠️  [{i}/{len(articles)}] 抓取失败: {article.get('title', 'Unknown')[:50]}, 错误: {e}")
                    # 抓取失败：使用摘要作为内容
                    article["summary"] = article.get("content", "")
                    article["content"] = article.get("content", "")
                    articles_with_full_content.append(article)

            logger.info(f"  ✅ 内容抓取完成: {len(articles_with_full_content)} 篇文章")
            articles = articles_with_full_content

        new_count = 0
        saved_article_ids = []

        for article in articles:
            result = self._save_or_update_article_and_get_id(db, article)
            if result:
                saved_article_ids.append(result["id"])
                if result["is_new"]:
                    new_count += 1

        result = {"total": len(articles), "new": new_count, "ai_analyzed": 0}

        # 检查AI分析条件并记录日志
        if not enable_ai_analysis:
            logger.info(f"  ℹ️  {source_name}: AI分析未启用（enable_ai_analysis=False）")
        elif not self.ai_analyzer:
            logger.warning(f"  ⚠️  {source_name}: AI分析器未初始化，无法进行AI分析。请检查LLM提供商和向量模型配置。")
        elif not saved_article_ids:
            logger.info(f"  ℹ️  {source_name}: 没有保存的文章，跳过AI分析")
        else:
            # 所有条件满足，进行AI分析
            unanalyzed_ids = self._filter_unanalyzed_articles(db, saved_article_ids)
            ai_skipped = len(saved_article_ids) - len(unanalyzed_ids)

            if ai_skipped > 0:
                logger.info(f"  ⏭️  {source_name}: 跳过 {ai_skipped} 篇已分析的文章")

            if unanalyzed_ids:
                logger.info(f"  🤖 {source_name}: 开始AI分析 {len(unanalyzed_ids)} 篇文章...")
                analyzed_count = self._analyze_articles_by_ids(db, unanalyzed_ids, max_workers=3)
                result["ai_analyzed"] = analyzed_count
            else:
                logger.info(f"  ℹ️  {source_name}: 所有文章都已分析过，无需重新分析")

        return result

    def _collect_api_sources(
        self, 
        db, 
        task_id: Optional[int] = None, 
        enable_ai_analysis: bool = False
    ) -> CollectionStats:
        """
        采集API源

        Args:
            db: 数据库管理器
            task_id: 任务ID
            enable_ai_analysis: 是否启用AI分析

        Returns:
            采集统计信息
        """
        stats: CollectionStats = {
            "sources_success": 0,
            "sources_error": 0,
            "new_articles": 0,
            "total_articles": 0,
            "ai_analyzed_count": 0,
            "start_time": datetime.now(),
        }

        api_configs = []
        with db.get_session() as session:
            db_sources = session.query(RSSSource).filter(
                RSSSource.enabled == True,
                RSSSource.source_type == "api"
            ).order_by(RSSSource.priority.asc()).all()

            for source in db_sources:
                config = {
                    "name": source.name,
                    "url": source.url,
                    "enabled": source.enabled,
                    "category": source.category,
                    "sub_type": source.sub_type,  # 读取sub_type字段
                }

                if source.extra_config:
                    extra_config = self._parse_json_safely(source.extra_config)
                    if extra_config:
                        config.update(extra_config)

                api_configs.append(config)
                _ = source.id
                _ = source.name
                _ = source.url
                _ = source.enabled
            session.expunge_all()

        # 只从数据库读取源，如果数据库中没有源则不采集
        if not api_configs:
            logger.info("  ℹ️  数据库中没有启用的API源，跳过采集")
            return stats

        for config in api_configs:
            if not config.get("enabled", True):
                continue

            # 合并 extra_config 到主配置
            config = self._merge_extra_config(config)
            name = config.get("name")
            sub_type = config.get("sub_type")  # 从数据库读取的sub_type

            try:
                # 使用source_type和sub_type获取采集器
                collector, collector_name = self._get_collector_by_type("api", sub_type)
                
                if not collector:
                    error_msg = f"{name}: 无法确定API采集器类型。请设置sub_type字段 (arxiv/huggingface/paperswithcode/twitter)"
                    logger.error(f"  ❌ {error_msg}")
                    stats["sources_error"] += 1
                    self._log_collection(db, name, "api", "error", 0, error_msg, task_id=task_id)
                    
                    with db.get_session() as session:
                        source_obj = session.query(RSSSource).filter(RSSSource.name == name).first()
                        if source_obj:
                            source_obj.last_error = error_msg
                            session.commit()
                    continue
                
                articles = []
                collector_used = collector_name
                
                # 根据不同的采集器调用相应的方法
                from backend.app.core.settings import settings
                settings.load_collector_settings()
                
                if collector_name == "arxiv":
                    query = config.get("query")
                    if not query:
                        raise ValueError(f"{name}: ArXiv采集器需要配置query参数")
                    max_results = config.get("max_results", settings.MAX_ARTICLES_PER_SOURCE)
                    articles = self.arxiv_collector.fetch_papers(query, max_results)
                
                elif collector_name == "huggingface":
                    limit = config.get("max_results", settings.MAX_ARTICLES_PER_SOURCE)
                    articles = self.hf_collector.fetch_trending_papers(limit)
                
                elif collector_name == "paperswithcode":
                    limit = config.get("max_results", settings.MAX_ARTICLES_PER_SOURCE)
                    articles = self.pwc_collector.fetch_trending_papers(limit)
                
                elif collector_name == "twitter":
                    # Twitter 使用专门的 Twitter 采集器（支持 Nitter RSS、TodayRss、Twitter API）
                    # 如果config中没有max_tweets，使用max_articles或配置值
                    if "max_tweets" not in config:
                        config["max_tweets"] = config.get("max_articles", settings.MAX_ARTICLES_PER_SOURCE)
                    articles = self.twitter_collector.fetch_tweets(config)

                if not articles:
                    logger.info(f"  ⚠️  {name}: 使用{collector_used}采集器未获取到文章")
                    stats["sources_error"] += 1
                    self._log_collection(db, name, "api", "error", 0, f"使用{collector_used}采集器未获取到文章", task_id=task_id)
                    continue

                process_result = self._process_articles_from_source(
                    db, articles, name, "api",
                    enable_ai_analysis, task_id=task_id,
                    fetch_full_content=False
                )

                self._log_collection(db, name, "api", "success", process_result["total"], task_id=task_id)
                stats["sources_success"] += 1
                stats["new_articles"] += process_result["new"]
                stats["total_articles"] += process_result["total"]
                stats["ai_analyzed_count"] += process_result["ai_analyzed"]

                with db.get_session() as session:
                    source_obj = session.query(RSSSource).filter(RSSSource.name == name).first()
                    if source_obj:
                        source_obj.last_collected_at = datetime.now()
                        source_obj.articles_count += len(articles)
                        source_obj.last_error = None

                        latest_article = session.query(Article).filter(
                            Article.source == name,
                            Article.published_at.isnot(None)
                        ).order_by(Article.published_at.desc()).first()

                        if latest_article:
                            source_obj.latest_article_published_at = latest_article.published_at

                        session.commit()

                logger.info(f"  ✅ {name}: {process_result['total']} 篇, 新增 {process_result['new']} 篇, AI分析 {process_result['ai_analyzed']} 篇")

            except Exception as e:
                logger.error(f"  ❌ {name}: {e}")
                self._log_collection(db, name, "api", "error", 0, str(e), task_id=task_id)
                stats["sources_error"] += 1
                
                with db.get_session() as session:
                    source_obj = session.query(RSSSource).filter(RSSSource.name == name).first()
                    if source_obj:
                        source_obj.last_error = str(e)
                        session.commit()

        logger.info(f"  ✅ API采集完成: 成功 {stats['sources_success']} 个源, 失败 {stats['sources_error']} 个源")
        logger.info(f"     总文章: {stats['total_articles']} 篇, 新增: {stats['new_articles']} 篇, AI分析: {stats['ai_analyzed_count']} 篇")

        return stats

    def _collect_web_sources(
        self, 
        db, 
        task_id: Optional[int] = None, 
        enable_ai_analysis: bool = False
    ) -> CollectionStats:
        """
        采集网站源（通过网页爬取）

        Args:
            db: 数据库管理器
            task_id: 任务ID
            enable_ai_analysis: 是否启用AI分析

        Returns:
            采集统计信息
        """
        stats: CollectionStats = {
            "sources_success": 0,
            "sources_error": 0,
            "new_articles": 0,
            "total_articles": 0,
            "ai_analyzed_count": 0,
            "start_time": datetime.now(),
        }

        # 优先从数据库读取Web源
        web_configs = []
        with db.get_session() as session:
            db_sources = session.query(RSSSource).filter(
                RSSSource.enabled == True,
                RSSSource.source_type == "web"
            ).order_by(RSSSource.priority.asc()).all()

            for source in db_sources:
                config = {
                    "name": source.name,
                    "url": source.url,
                    "enabled": source.enabled,
                }
                
                # 优先使用 extra_config 字段，如果没有则尝试从 note 字段解析
                if source.extra_config:
                    extra_config = self._parse_json_safely(source.extra_config)
                    if extra_config:
                        config["extra_config"] = extra_config
                elif source.note:
                    note_config = self._parse_json_safely(source.note)
                    # 如果note是extra_config格式，将其放入extra_config字段
                    if note_config:
                        config["extra_config"] = note_config
                    else:
                        config["note"] = source.note
                
                web_configs.append(config)
                # 预先加载属性
                _ = source.id
                _ = source.name
                _ = source.url
                _ = source.enabled
            session.expunge_all()

        # 只从数据库读取源，如果数据库中没有源则不采集
        if not web_configs:
            logger.info("  ℹ️  数据库中没有启用的Web源，跳过采集")
            return stats

        logger.info(f"  🚀 开始采集 {len(web_configs)} 个网站源")

        for config in web_configs:
            if not config.get("enabled", True):
                continue

            # 合并 extra_config 到主配置
            config = self._merge_extra_config(config)
            source_name = config.get("name", "Unknown")
            
            # 如果没有配置max_articles，使用全局配置值
            if "max_articles" not in config:
                from backend.app.core.settings import settings
                settings.load_collector_settings()
                config["max_articles"] = settings.MAX_ARTICLES_PER_SOURCE

            try:
                logger.info(f"  🌐 开始采集网站: {source_name}")

                # 检查是否有必要的配置（article_selector）
                if not config.get("article_selector"):
                    logger.warning(f"  ⚠️  {source_name}: 缺少 article_selector 配置，跳过")
                    stats["sources_error"] += 1
                    self._log_collection(db, source_name, "web", "error", 0, "缺少 article_selector 配置", task_id=task_id)
                    continue

                articles = self.web_collector.fetch_articles(config)

                if not articles:
                    logger.info(f"  ⚠️  {source_name}: 未获取到文章")
                    stats["sources_error"] += 1
                    self._log_collection(db, source_name, "web", "error", 0, "未获取到文章", task_id=task_id)
                    continue

                process_result = self._process_articles_from_source(
                    db, articles, source_name, "web",
                    enable_ai_analysis, task_id=task_id,
                    fetch_full_content=False
                )

                # 更新Web源的统计信息
                with db.get_session() as session:
                    source_obj = session.query(RSSSource).filter(RSSSource.name == source_name).first()
                    if source_obj:
                        source_obj.last_collected_at = datetime.now()
                        source_obj.articles_count += len(articles)
                        source_obj.last_error = None

                        # 更新最新文章发布时间
                        latest_article = session.query(Article).filter(
                            Article.source == source_name,
                            Article.published_at.isnot(None)
                        ).order_by(Article.published_at.desc()).first()

                        if latest_article:
                            source_obj.latest_article_published_at = latest_article.published_at

                        session.commit()

                self._log_collection(db, source_name, "web", "success", process_result["total"], task_id=task_id)
                stats["sources_success"] += 1
                stats["new_articles"] += process_result["new"]
                stats["total_articles"] += process_result["total"]
                stats["ai_analyzed_count"] += process_result["ai_analyzed"]

                logger.info(f"  ✅ {source_name}: {process_result['total']} 篇, 新增 {process_result['new']} 篇, AI分析 {process_result['ai_analyzed']} 篇")

            except Exception as e:
                logger.error(f"  ❌ {source_name}: {e}")
                stats["sources_error"] += 1
                self._log_collection(db, source_name, "web", "error", 0, str(e), task_id=task_id)
                
                # 更新错误信息
                with db.get_session() as session:
                    source_obj = session.query(RSSSource).filter(RSSSource.name == source_name).first()
                    if source_obj:
                        source_obj.last_error = str(e)
                        session.commit()

        logger.info(f"  ✅ 网站源采集完成: 成功 {stats['sources_success']} 个源, 失败 {stats['sources_error']} 个源")
        logger.info(f"     总文章: {stats['total_articles']} 篇, 新增: {stats['new_articles']} 篇, AI分析: {stats['ai_analyzed_count']} 篇")

        return stats

    def _collect_email_sources(
        self, 
        db, 
        task_id: Optional[int] = None, 
        enable_ai_analysis: bool = False
    ) -> CollectionStats:
        """
        采集邮件源

        Args:
            db: 数据库管理器
            task_id: 任务ID
            enable_ai_analysis: 是否启用AI分析

        Returns:
            采集统计信息
        """
        stats: CollectionStats = {
            "sources_success": 0,
            "sources_error": 0,
            "new_articles": 0,
            "total_articles": 0,
            "ai_analyzed_count": 0,
            "start_time": datetime.now(),
        }

        # 从数据库读取邮件源
        email_configs = []
        with db.get_session() as session:
            db_sources = session.query(RSSSource).filter(
                RSSSource.enabled == True,
                RSSSource.source_type == "email"
            ).order_by(RSSSource.priority.asc()).all()

            for source in db_sources:
                config = {
                    "id": source.id,
                    "name": source.name,
                    "url": source.url,
                    "enabled": source.enabled,
                }

                if source.extra_config:
                    extra_config = self._parse_json_safely(source.extra_config)
                    if extra_config:
                        config.update(extra_config)
                
                # 读取analysis_prompt配置
                if source.analysis_prompt:
                    config["analysis_prompt"] = source.analysis_prompt

                email_configs.append(config)
            session.expunge_all()

        # 只从数据库读取源，如果数据库中没有源则不采集
        if not email_configs:
            logger.info("  ℹ️  数据库中没有启用的邮件源，跳过采集")
            return stats

        logger.info(f"  🚀 开始采集 {len(email_configs)} 个邮件源")

        for config in email_configs:
            if not config.get("enabled", True):
                continue

            # 合并 extra_config 到主配置
            config = self._merge_extra_config(config)
            source_name = config.get("name", "Unknown")

            try:
                logger.info(f"  📧 开始采集邮件: {source_name}")

                # 验证配置
                is_valid, error_msg = self.email_collector.validate_config(config)
                if not is_valid:
                    logger.warning(f"  ⚠️  {source_name}: {error_msg}")
                    stats["sources_error"] += 1
                    self._log_collection(db, source_name, "email", "error", 0, error_msg, task_id=task_id)
                    continue

                # 采集文章
                articles = self.email_collector.fetch_articles(config)

                if not articles:
                    logger.info(f"  ⚠️  {source_name}: 未获取到文章")
                    stats["sources_error"] += 1
                    self._log_collection(db, source_name, "email", "error", 0, "未获取到文章", task_id=task_id)
                    continue

                # 检查是否需要多文章解析
                analysis_prompt = config.get("analysis_prompt", "")
                if analysis_prompt and self._is_multi_article_prompt(analysis_prompt) and self.ai_analyzer:
                    logger.info(f"  🔍 检测到多文章解析提示词，开始解析邮件内容...")
                    articles = self._extract_multiple_articles_from_emails(articles, analysis_prompt, source_name)
                    logger.info(f"  ✅ 多文章解析完成，提取到 {len(articles)} 篇文章")

                # 统一在_process_articles_from_source中抓取完整内容
                process_result = self._process_articles_from_source(
                    db, articles, source_name, "email",
                    enable_ai_analysis, task_id=task_id,
                    fetch_full_content=True
                )

                # 更新邮件源的统计信息
                source_id = config.get("id")
                with db.get_session() as session:
                    if source_id:
                        source_obj = session.query(RSSSource).filter(RSSSource.id == source_id).first()
                    else:
                        source_obj = session.query(RSSSource).filter(RSSSource.name == source_name).first()
                    
                    if source_obj:
                        source_obj.last_collected_at = datetime.now()
                        source_obj.articles_count = process_result.get("new_articles", 0) + process_result.get("skipped_articles", 0)
                        source_obj.last_error = None

                        # 更新最新文章发布时间
                        latest_article = session.query(Article).filter(
                            Article.source == source_name,
                            Article.published_at.isnot(None)
                        ).order_by(Article.published_at.desc()).first()

                        if latest_article:
                            source_obj.latest_article_published_at = latest_article.published_at

                        session.commit()

                self._log_collection(db, source_name, "email", "success", process_result["total"], task_id=task_id)
                stats["sources_success"] += 1
                stats["new_articles"] += process_result["new"]
                stats["total_articles"] += process_result["total"]
                stats["ai_analyzed_count"] += process_result["ai_analyzed"]

                logger.info(f"  ✅ {source_name}: {process_result['total']} 篇, 新增 {process_result['new']} 篇, AI分析 {process_result['ai_analyzed']} 篇")

            except Exception as e:
                logger.error(f"  ❌ {source_name}: {e}")
                stats["sources_error"] += 1
                self._log_collection(db, source_name, "email", "error", 0, str(e), task_id=task_id)
                
                # 更新错误信息
                with db.get_session() as session:
                    source_obj = session.query(RSSSource).filter(RSSSource.name == source_name).first()
                    if source_obj:
                        source_obj.last_error = str(e)
                        session.commit()

        logger.info(f"  ✅ 邮件源采集完成: 成功 {stats['sources_success']} 个源, 失败 {stats['sources_error']} 个源")
        logger.info(f"     总文章: {stats['total_articles']} 篇, 新增: {stats['new_articles']} 篇, AI分析: {stats['ai_analyzed_count']} 篇")

        return stats

    def _save_or_update_article_and_get_id(
        self, 
        db, 
        article: ArticleDict
    ) -> Optional[Dict[str, Union[int, bool]]]:
        """
        保存或更新文章到数据库并返回文章ID和信息

        Returns:
            {"id": int, "is_new": bool} - 文章ID和是否为新文章
            如果保存失败返回None
        """
        max_retries = 3
        for attempt in range(max_retries):
            try:
                with db.get_session() as session:
                    # 检查是否已存在
                    existing = session.query(Article).filter(Article.url == article["url"]).first()

                    if existing:
                        # 文章已存在，更新内容（如果新内容更完整）
                        content = article.get("content", "")
                        if content and content.strip():  # 如果有新内容
                            # 只在内容为空或明显更短时才更新
                            if not existing.content or (existing.content and len(content) > len(existing.content)):
                                existing.content = content
                                # 更新source字段，确保使用正确的订阅源名称
                                existing.source = article.get("source", existing.source)

                                session.commit()
                                return {"id": existing.id, "is_new": False}
                        return {"id": existing.id, "is_new": False}

                    # 创建新文章
                    content = article.get("content", "")
                    summary = article.get("summary", "")  # 从邮件中提取的摘要
                    new_article = Article(
                        title=article.get("title"),
                        url=article.get("url"),
                        content=content,
                        summary=summary,  # 保存摘要
                        source=article.get("source"),
                        category=article.get("category"),
                        author=article.get("author"),
                        published_at=article.get("published_at"),
                        extra_data=article.get("metadata"),
                    )

                    session.add(new_article)
                    session.commit()

                    # 返回新插入的文章ID
                    return {"id": new_article.id, "is_new": True}

            except Exception as e:
                # 如果是唯一性约束错误，可能是由并发引起的，重试
                if "UNIQUE constraint failed" in str(e) and attempt < max_retries - 1:
                    logger.warning(f"⚠️  并发冲突，第 {attempt + 1} 次重试: {article.get('url', 'Unknown')}")
                    time.sleep(0.1 * (attempt + 1))  # 递增延迟
                    continue
                else:
                    logger.error(f"❌ 保存或更新文章失败: {e}")
                    return None

        return None


    def _analyze_articles(
        self, 
        db, 
        batch_size: int = 50, 
        max_age_days: Optional[int] = None, 
        max_workers: int = 3
    ) -> CollectionStats:
        """
        AI分析未分析的文章（并发）
        
        Args:
            batch_size: 批次大小
            max_age_days: 最大文章年龄（天数），超过此天数的文章不分析。如果为None，则使用配置中的值
            max_workers: 最大并发数，默认3
        """
        from backend.app.core.settings import settings
        
        # 如果未指定max_age_days，使用配置中的值
        if max_age_days is None:
            max_age_days = settings.MAX_ANALYSIS_AGE_DAYS
        
        stats = {"analyzed_count": 0, "analysis_error": 0, "skipped_old": 0}

        with db.get_session() as session:
            # 计算时间阈值（只分析最近max_age_days天的文章）
            # 如果max_age_days为0，表示不限制，分析所有文章
            if max_age_days > 0:
                time_threshold = datetime.now() - timedelta(days=max_age_days)
            else:
                time_threshold = None
            
            # 获取未分析的文章（只分析最近的文章）
            query = session.query(Article).filter(
                Article.is_processed == False,
                Article.published_at.isnot(None)
            )
            
            # 如果配置了时间限制，添加时间过滤
            if time_threshold:
                query = query.filter(Article.published_at >= time_threshold)
            
            unanalyzed = query.order_by(Article.published_at.desc()).limit(batch_size).all()
            
            # 统计跳过的旧文章（仅在配置了时间限制时）
            if time_threshold:
                skipped_count = (
                    session.query(Article)
                    .filter(
                        Article.is_processed == False,
                        Article.published_at.isnot(None),
                        Article.published_at < time_threshold
                    )
                    .count()
                )
            else:
                skipped_count = 0
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

            # 为每个线程创建独立的AIAnalyzer实例，避免并发冲突
            # OpenAI客户端内部有连接池，多线程共享不安全
            from backend.app.utils.factories import create_ai_analyzer

            # 并发分析文章
            # 使用默认参数捕获 article.id，避免闭包陷阱和 DetachedInstanceError
            def analyze_single_article(article_obj, article_id=None):
                """分析单篇文章（用于并发执行）"""
                # 为每个线程创建独立的AI分析器实例
                thread_ai_analyzer = create_ai_analyzer()

                # 如果传入的是 article 对象，提取 ID；否则使用传入的 article_id
                if article_id is None:
                    article_id = article_obj.id if hasattr(article_obj, 'id') else None

                try:
                    # 为每个线程创建独立的数据库会话
                    with db.get_session() as article_session:
                        # 重新查询文章（避免DetachedInstanceError）
                        article_obj = article_session.query(Article).filter(Article.id == article_id).first()
                        if not article_obj:
                            return {"success": False, "reason": "article_not_found"}

                        # 如果已经分析过，跳过AI分析
                        if article_obj.is_processed:
                            return {"success": False, "reason": "already_processed"}

                        # 准备文章数据
                        article_dict = {
                            "title": article_obj.title,
                            "content": article_obj.content,
                            "source": article_obj.source,
                            "published_at": article_obj.published_at,
                        }

                        # 获取自定义提示词（如果源配置了）
                        custom_prompt = None
                        if article_obj.source:
                            source_obj = session.query(RSSSource).filter(
                                RSSSource.name == article_obj.source
                            ).first()
                            if source_obj and source_obj.analysis_prompt:
                                custom_prompt = source_obj.analysis_prompt

                        # AI分析（使用线程独立的AI分析器）
                        result = thread_ai_analyzer.analyze_article(
                            article_dict, 
                            custom_prompt=custom_prompt
                        )

                        # 更新文章
                        # 确保 summary 是字符串类型（AI可能返回dict）
                        summary_value = result.get("summary", "")
                        if isinstance(summary_value, dict):
                            # 如果是字典，提取文本内容或转换为JSON字符串
                            if "text" in summary_value:
                                summary_value = summary_value["text"]
                            elif "content" in summary_value:
                                summary_value = summary_value["content"]
                            else:
                                summary_value = json.dumps(summary_value, ensure_ascii=False)
                        elif not isinstance(summary_value, str):
                            summary_value = str(summary_value) if summary_value else ""

                        # 确保 detailed_summary 是字符串类型（AI可能返回dict）
                        detailed_summary_value = result.get("detailed_summary", "")
                        if isinstance(detailed_summary_value, dict):
                            # 如果是字典，提取文本内容或转换为JSON字符串
                            if "text" in detailed_summary_value:
                                detailed_summary_value = detailed_summary_value["text"]
                            elif "content" in detailed_summary_value:
                                detailed_summary_value = detailed_summary_value["content"]
                            else:
                                detailed_summary_value = json.dumps(detailed_summary_value, ensure_ascii=False)
                        elif not isinstance(detailed_summary_value, str):
                            detailed_summary_value = str(detailed_summary_value) if detailed_summary_value else ""

                        article_obj.summary = summary_value
                        article_obj.detailed_summary = detailed_summary_value
                        article_obj.tags = result.get("tags")
                        article_obj.importance = result.get("importance")
                        article_obj.target_audience = result.get("target_audience")
                        # 保存中文标题（如果AI分析返回了title_zh）
                        if result.get("title_zh"):
                            article_obj.title_zh = result.get("title_zh")
                        article_obj.is_processed = True

                        article_session.commit()
                        return {"success": True, "article_id": article_obj.id}
                        
                except Exception as e:
                    logger.error(f"  ❌ 分析文章失败 (ID={article_id}): {e}")
                    return {"success": False, "error": str(e)}

            # 使用线程池并发分析
            # 使用默认参数捕获 article.id，避免闭包陷阱
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_article = {
                    executor.submit(analyze_single_article, article, article.id): article
                    for article in unanalyzed
                }
                
                completed = 0
                for future in as_completed(future_to_article):
                    article = future_to_article[future]
                    article_id = article.id  # 提前保存 ID，避免 DetachedInstanceError
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
                        logger.error(f"  ❌ 分析文章异常 (ID={article_id}): {e}")
                        stats["analysis_error"] += 1

        logger.info(f"  ✅ AI分析完成: {stats['analyzed_count']} 篇成功, {stats['analysis_error']} 篇失败")
        return stats

    def _analyze_articles_by_ids(self, db, article_ids: List[int], max_workers: int = 3) -> int:
        """
        根据文章ID列表进行并发AI分析

        Args:
            db: 数据库管理器
            article_ids: 文章ID列表
            max_workers: 最大并发数

        Returns:
            成功分析的文章数量
        """
        if not article_ids or not self.ai_analyzer:
            return 0

        analyzed_count = 0

        # 为每个线程创建独立的AIAnalyzer实例，避免并发冲突
        # OpenAI客户端内部有连接池，多线程共享不安全
        from backend.app.utils.factories import create_ai_analyzer

        def analyze_single_article_id(article_id):
            """根据ID分析单篇文章"""
            try:
                # 为每个线程创建独立的AI分析器实例
                thread_ai_analyzer = create_ai_analyzer()

                # 为每个线程创建独立的数据库会话
                with db.get_session() as session:
                    # 重新查询文章
                    article_obj = session.query(Article).filter(Article.id == article_id).first()
                    if not article_obj or article_obj.is_processed:
                        return {"success": False, "reason": "already_processed"}

                    # 准备文章数据
                    article_dict = {
                        "title": article_obj.title,
                        "content": article_obj.content,
                        "source": article_obj.source,
                        "published_at": article_obj.published_at,
                    }

                    # 获取自定义提示词（如果源配置了）
                    custom_prompt = None
                    if article_obj.source:
                        source_obj = session.query(RSSSource).filter(
                            RSSSource.name == article_obj.source
                        ).first()
                        if source_obj and source_obj.analysis_prompt:
                            custom_prompt = source_obj.analysis_prompt

                    # AI分析（使用线程独立的AI分析器）
                    result = thread_ai_analyzer.analyze_article(
                        article_dict,
                        custom_prompt=custom_prompt
                    )

                    # 更新文章
                    # 确保 summary 是字符串类型（AI可能返回dict）
                    summary_value = result.get("summary", "")
                    if isinstance(summary_value, dict):
                        # 如果是字典，提取文本内容或转换为JSON字符串
                        if "text" in summary_value:
                            summary_value = summary_value["text"]
                        elif "content" in summary_value:
                            summary_value = summary_value["content"]
                        else:
                            summary_value = json.dumps(summary_value, ensure_ascii=False)
                    elif not isinstance(summary_value, str):
                        summary_value = str(summary_value) if summary_value else ""

                    # 确保 detailed_summary 是字符串类型（AI可能返回dict）
                    detailed_summary_value = result.get("detailed_summary", "")
                    if isinstance(detailed_summary_value, dict):
                        # 如果是字典，提取文本内容或转换为JSON字符串
                        if "text" in detailed_summary_value:
                            detailed_summary_value = detailed_summary_value["text"]
                        elif "content" in detailed_summary_value:
                            detailed_summary_value = detailed_summary_value["content"]
                        else:
                            detailed_summary_value = json.dumps(detailed_summary_value, ensure_ascii=False)
                    elif not isinstance(detailed_summary_value, str):
                        detailed_summary_value = str(detailed_summary_value) if detailed_summary_value else ""

                    article_obj.summary = summary_value
                    article_obj.detailed_summary = detailed_summary_value
                    article_obj.tags = result.get("tags")
                    article_obj.importance = result.get("importance")
                    article_obj.target_audience = result.get("target_audience")
                    # 保存中文标题（如果AI分析返回了title_zh）
                    if result.get("title_zh"):
                        article_obj.title_zh = result.get("title_zh")
                    article_obj.is_processed = True

                    session.commit()
                    return {"success": True, "article_id": article_obj.id}

            except Exception as e:
                logger.error(f"  ❌ 分析文章失败 (ID={article_id}): {e}")
                return {"success": False, "error": str(e)}

        # 使用线程池并发分析
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_id = {
                executor.submit(analyze_single_article_id, article_id): article_id
                for article_id in article_ids
            }

            completed = 0
            for future in as_completed(future_to_id):
                article_id = future_to_id[future]
                completed += 1

                try:
                    result = future.result()
                    if result.get("success"):
                        analyzed_count += 1
                        if completed % 5 == 0 or completed == len(article_ids):
                            logger.info(f"  ✅ [{completed}/{len(article_ids)}] AI分析进度")
                except Exception as e:
                    logger.error(f"  ❌ 分析文章异常 (ID={article_id}): {e}")

        logger.info(f"  ✅ AI分析完成: {analyzed_count} 篇")
        return analyzed_count

    def _filter_unanalyzed_articles(self, db, article_ids: List[int]) -> List[int]:
        """
        过滤出未分析的文章ID列表

        Args:
            db: 数据库管理器
            article_ids: 文章ID列表

        Returns:
            未分析的文章ID列表
        """
        if not article_ids:
            return []

        try:
            with db.get_session() as session:
                # 查询未分析的文章
                unanalyzed = session.query(Article.id).filter(
                    Article.id.in_(article_ids),
                    Article.is_processed == False
                ).all()

                return [row[0] for row in unanalyzed]
        except Exception as e:
            logger.error(f"❌ 查询未分析文章失败: {e}")
            return article_ids  # 如果查询失败，返回所有ID继续处理

    def _recover_stuck_tasks(self, db):
        """
        检测并恢复挂起的采集任务
        
        如果发现状态为running但超过一定时间（默认1小时）的任务，将其标记为error
        """
        try:
            from backend.app.db.models import CollectionTask
            with db.get_session() as session:
                # 查找所有running状态的任务
                running_tasks = session.query(CollectionTask).filter(
                    CollectionTask.status == "running"
                ).all()
                
                if not running_tasks:
                    return
                
                # 超时时间：1小时
                timeout_threshold = timedelta(hours=1)
                current_time = datetime.now()
                
                for task in running_tasks:
                    # 计算任务运行时间
                    running_time = current_time - task.started_at
                    
                    if running_time > timeout_threshold:
                        # 任务超时，标记为error
                        logger.warning(
                            f"⚠️  检测到挂起的采集任务 (ID: {task.id})，"
                            f"运行时间: {running_time.total_seconds()/3600:.1f}小时，"
                            f"将其标记为error状态"
                        )
                        task.status = "error"
                        task.error_message = f"任务超时中断（运行时间超过{timeout_threshold.total_seconds()/3600:.1f}小时）"
                        task.completed_at = current_time
                        session.commit()
                        logger.info(f"✅ 已恢复挂起的任务 (ID: {task.id})")
                    else:
                        # 任务还在运行中，但时间较短，可能是正常的
                        logger.debug(
                            f"ℹ️  发现运行中的任务 (ID: {task.id})，"
                            f"运行时间: {running_time.total_seconds()/60:.1f}分钟"
                        )
        except Exception as e:
            logger.error(f"❌ 恢复挂起任务失败: {e}", exc_info=True)

    def _log_collection(self, db, source_name: str, source_type: str, status: str, count: int, error: str = None, task_id: int = None):
        """记录采集日志"""
        try:
            with db.get_session() as session:
                log = CollectionLog(
                    source_name=source_name,
                    source_type=source_type,
                    status=status,
                    articles_count=count,
                    error_message=error,
                    task_id=task_id,
                )
                session.add(log)
                session.commit()
        except Exception as e:
            logger.error(f"❌ 记录日志失败: {e}")

    def generate_daily_summary(self, db, date: datetime = None):
        """
        生成每日总结

        Args:
            db: 数据库管理器
            date: 总结日期（默认今天）
        """
        if not self.summary_generator:
            logger.warning("⚠️  未初始化AI分析器，无法生成总结")
            return None

        return self.summary_generator.generate_daily_summary(db, date)

    def _is_multi_article_prompt(self, prompt: str) -> bool:
        """
        检查提示词是否包含多文章解析的指示
        
        Args:
            prompt: 提示词文本
            
        Returns:
            如果提示词要求输出多篇文章（JSON格式，每篇文章一个item），返回True
        """
        if not prompt:
            return False
        
        # 检查提示词中是否包含多文章解析的关键词
        multi_article_keywords = [
            "每篇文章一个item",
            "每篇文章一个 item",
            "每篇文章一个item",
            "多个文章",
            "多篇文章",
            "文章列表",
            "items",
            "item数组",
            "JSON格式",
            "输出json",
        ]
        
        prompt_lower = prompt.lower()
        for keyword in multi_article_keywords:
            if keyword.lower() in prompt_lower:
                return True
        
        return False
    
    def _extract_multiple_articles_from_emails(
        self, 
        articles: List[ArticleDict], 
        analysis_prompt: str,
        source_name: str
    ) -> List[ArticleDict]:
        """
        从邮件中提取多篇文章
        
        Args:
            articles: 原始文章列表（每封邮件对应一篇文章）
            analysis_prompt: 分析提示词
            source_name: 源名称
            
        Returns:
            提取后的文章列表（每篇文章对应一个item）
        """
        if not self.ai_analyzer:
            logger.warning("⚠️  AI分析器未初始化，无法进行多文章解析")
            return articles
        
        extracted_articles = []
        
        for article in articles:
            try:
                # 构建多文章解析的提示词
                # 提示词应该要求输出JSON格式，包含一个items数组，每个item是一篇文章
                multi_article_prompt = f"""{analysis_prompt}

请将邮件内容解析为多篇文章，每篇文章一个item，输出JSON格式：
{{
    "items": [
        {{
            "title": "文章标题",
            "content": "文章内容（保留Markdown格式和链接）",
            "url": "文章链接（如果有）"
        }},
        ...
    ]
}}

如果邮件中只有一篇文章，也请按照上述格式输出，items数组中只有一个item。
如果邮件中没有文章内容，请返回空的items数组：{{"items": []}}

邮件标题: {article.get("title", "")}
邮件内容:
{article.get("content", "")}
"""
                
                logger.info(f"  🤖 正在解析邮件: {article.get('title', '')[:50]}...")
                
                # 调用AI分析器解析
                result = self.ai_analyzer.client.chat.completions.create(
                    model=self.ai_analyzer.model,
                    messages=[
                        {
                            "role": "system",
                            "content": "你是一个专业的内容解析专家，擅长从邮件中提取多篇文章。请严格按照JSON格式输出，确保每个item都是完整的文章信息。"
                        },
                        {
                            "role": "user",
                            "content": multi_article_prompt
                        }
                    ],
                    temperature=0.3,
                    max_tokens=16000,  # 支持更长的输出
                )
                
                result_text = result.choices[0].message.content.strip()
                
                # 解析JSON响应
                json_text = result_text
                if result_text.startswith('```'):
                    # 提取JSON部分（去除 ```json 和 ``` 标记）
                    lines = result_text.split('\n')
                    json_lines = []
                    started = False
                    for line in lines:
                        if line.strip().startswith('```'):
                            if not started:
                                started = True
                                continue
                            else:
                                break
                        if started:
                            json_lines.append(line)
                    json_text = '\n'.join(json_lines)
                
                # 解析JSON
                parsed_result = json.loads(json_text)
                
                # 提取items数组
                items = parsed_result.get("items", [])
                
                if not items:
                    logger.warning(f"  ⚠️  邮件中未提取到文章: {article.get('title', '')[:50]}...")
                    # 如果没有提取到文章，保留原始文章
                    extracted_articles.append(article)
                    continue
                
                logger.info(f"  ✅ 从邮件中提取到 {len(items)} 篇文章")
                
                # 将每个item转换为文章对象
                for idx, item in enumerate(items):
                    # 使用原始文章的元数据
                    extracted_article = {
                        "title": item.get("title", article.get("title", f"文章 {idx + 1}")),
                        "url": item.get("url", article.get("url", "")),
                        "content": item.get("content", ""),
                        "source": source_name,
                        "author": article.get("author", ""),
                        "published_at": article.get("published_at", datetime.now()),
                        "category": "email",
                        "metadata": {
                            **article.get("metadata", {}),
                            "extracted_from_email": True,
                            "email_title": article.get("title", ""),
                            "article_index": idx + 1,
                            "total_articles": len(items),
                        },
                    }
                    
                    extracted_articles.append(extracted_article)
                    
            except json.JSONDecodeError as e:
                logger.error(f"  ❌ JSON解析失败: {e}")
                if 'result_text' in locals():
                    logger.error(f"  原始响应: {result_text[:500]}...")
                # 解析失败，保留原始文章
                extracted_articles.append(article)
            except Exception as e:
                logger.error(f"  ❌ 多文章解析失败: {e}")
                import traceback
                logger.error(f"  详细错误: {traceback.format_exc()}")
                # 解析失败，保留原始文章
                extracted_articles.append(article)
        
        return extracted_articles

    def generate_weekly_summary(self, db, date: datetime = None):
        """
        生成每周总结

        Args:
            db: 数据库管理器
            date: 总结日期（默认今天）
        """
        if not self.summary_generator:
            logger.warning("⚠️  未初始化AI分析器，无法生成总结")
            return None

        return self.summary_generator.generate_weekly_summary(db, date)
