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

        # 1. 采集RSS源（双层并发：多个RSS源 + 每个源内部并发获取内容+AI分析）
        logger.info("\n📡 采集RSS源（双层并发模式）")
        rss_stats = self._collect_rss_sources(db, task_id=task_id, enable_ai_analysis=enable_ai_analysis)
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

        stats["end_time"] = datetime.now()
        stats["duration"] = (stats["end_time"] - stats["start_time"]).total_seconds()

        logger.info(f"\n✅ 采集完成！")
        logger.info(f"   总文章数: {stats['total_articles']}")
        logger.info(f"   新增文章: {stats['new_articles']}")
        logger.info(f"   成功源数: {stats['sources_success']}")
        logger.info(f"   AI分析数: {stats.get('ai_analyzed_count', 0)}")
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

    def _process_single_rss_source(self, db, source_name: str, feed_result: Dict[str, Any], enable_ai_analysis: bool = False) -> Dict[str, Any]:
        """
        处理单个RSS源：获取完整内容 -> 保存文章 -> AI分析（全流程并发）

        Args:
            db: 数据库管理器
            source_name: 订阅源名称
            feed_result: RSS采集结果
            enable_ai_analysis: 是否启用AI分析

        Returns:
            处理结果统计
        """
        result_stats = {
            "source_name": source_name,
            "total_articles": 0,
            "new_articles": 0,
            "skipped_articles": 0,  # 已存在的文章
            "ai_analyzed": 0,
            "ai_skipped": 0,  # 已分析的文章
            "success": False,
            "error": None
        }

        try:
            articles = feed_result.get("articles", [])
            feed_title = feed_result.get("feed_title")

            if not articles:
                result_stats["success"] = True
                return result_stats

            # 确保所有文章的source字段都是订阅源名称，并设置正确的author
            # 这是关键的防御性检查：强制覆盖所有文章的source字段，防止并发冲突
            from collector.rss_collector import _get_author_from_source
            from config.settings import settings
            
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
            self._log_collection(db, source_name, "rss", "success", len(articles))

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

            self._log_collection(db, source_name, "rss", "error", 0, str(e))

        return result_stats

    def _collect_rss_sources(self, db, task_id: int = None, enable_ai_analysis: bool = False) -> Dict[str, Any]:
        """
        采集RSS源（双层并发：多个RSS源同时采集 + 每个源内部并发获取内容+AI分析）

        Args:
            db: 数据库管理器
            task_id: 任务ID
            enable_ai_analysis: 是否在采集每个源后立即进行AI分析

        Returns:
            采集统计信息
        """
        stats = {"sources_success": 0, "sources_error": 0, "new_articles": 0, "total_articles": 0, "ai_analyzed_count": 0}

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
                def collect_single_source(config=config_copy, name=source_name):
                    try:
                        # 获取RSS feed（使用传入的config，确保每个线程使用正确的配置）
                        feed_data = self.rss_collector.fetch_single_feed(config)

                        # 处理这个源（包含获取完整内容、保存、AI分析）
                        # 使用传入的name，确保每个线程使用正确的源名称
                        result = self._process_single_rss_source(
                            db, name, feed_data, enable_ai_analysis
                        )
                        return result
                    except Exception as e:
                        logger.error(f"  ❌ {name} 采集失败: {e}")
                        return {
                            "source_name": name,
                            "success": False,
                            "error": str(e),
                            "total_articles": 0,
                            "new_articles": 0,
                            "ai_analyzed": 0
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
                        logger.error(f"  ❌ {source_name}: {result.get('error', '未知错误')}")

                except Exception as e:
                    logger.error(f"  ❌ {source_name} 处理异常: {e}")
                    stats["sources_error"] += 1

        logger.info(f"  ✅ RSS采集完成: 成功 {stats['sources_success']} 个源, 失败 {stats['sources_error']} 个源")
        logger.info(f"     总文章: {stats['total_articles']} 篇, 新增: {stats['new_articles']} 篇, AI分析: {stats['ai_analyzed_count']} 篇")

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

    def _save_article_and_get_id(self, db, article: Dict[str, Any]) -> int or None:
        """
        保存文章到数据库并返回文章ID

        Returns:
            文章ID（如果文章已存在返回None）
        """
        try:
            with db.get_session() as session:
                # 检查是否已存在
                existing = session.query(Article).filter(Article.url == article["url"]).first()

                if existing:
                    return None

                # 创建新文章
                content = article.get("content", "")
                new_article = Article(
                    title=article.get("title"),
                    url=article.get("url"),
                    content=content,
                    source=article.get("source"),
                    category=article.get("category"),
                    author=article.get("author"),
                    published_at=article.get("published_at"),
                    extra_data=article.get("metadata"),
                )

                session.add(new_article)
                session.commit()

                # 返回新插入的文章ID
                return new_article.id

        except Exception as e:
            logger.error(f"❌ 保存文章失败: {e}")
            return None

    def _save_or_update_article_and_get_id(self, db, article: Dict[str, Any]) -> Dict[str, Any] or None:
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

                                # 如果没有中文标题，尝试翻译
                                if not existing.title_zh and self.ai_analyzer:
                                    self._translate_article_title_if_needed(existing)

                                session.commit()
                                return {"id": existing.id, "is_new": False}
                        return {"id": existing.id, "is_new": False}

                    # 创建新文章
                    content = article.get("content", "")
                    new_article = Article(
                        title=article.get("title"),
                        url=article.get("url"),
                        content=content,
                        source=article.get("source"),
                        category=article.get("category"),
                        author=article.get("author"),
                        published_at=article.get("published_at"),
                        extra_data=article.get("metadata"),
                    )

                    session.add(new_article)
                    session.commit()

                    # 如果没有中文标题，尝试翻译
                    if not new_article.title_zh and self.ai_analyzer:
                        self._translate_article_title_if_needed(new_article)
                        session.commit()

                    # 返回新插入的文章ID
                    return {"id": new_article.id, "is_new": True}

            except Exception as e:
                # 如果是唯一性约束错误，可能是由并发引起的，重试
                if "UNIQUE constraint failed" in str(e) and attempt < max_retries - 1:
                    logger.warning(f"⚠️  并发冲突，第 {attempt + 1} 次重试: {article.get('url', 'Unknown')}")
                    import time
                    time.sleep(0.1 * (attempt + 1))  # 递增延迟
                    continue
                else:
                    logger.error(f"❌ 保存或更新文章失败: {e}")
                    return None

        return None

    def _translate_article_title_if_needed(self, article: Article):
        """
        如果文章标题是英文且没有中文翻译，则翻译为中文

        Args:
            article: 文章对象
        """
        import re

        # 如果已有中文标题，跳过
        if article.title_zh:
            return

        # 检查是否为英文：检查是否包含中文字符
        def is_english(text: str) -> bool:
            if not text:
                return False
            chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
            return chinese_chars / len(text) < 0.3

        if is_english(article.title):
            try:
                article.title_zh = self.ai_analyzer.translate_title(article.title)
                logger.info(f"  🌐 翻译标题: {article.title[:50]}... → {article.title_zh[:50]}...")
            except Exception as e:
                logger.warning(f"  ⚠️  标题翻译失败: {e}")

    def _analyze_articles(self, db, batch_size: int = 50, max_age_days: int = None, max_workers: int = 3) -> Dict[str, Any]:
        """
        AI分析未分析的文章（并发）
        
        Args:
            batch_size: 批次大小
            max_age_days: 最大文章年龄（天数），超过此天数的文章不分析。如果为None，则使用配置中的值
            max_workers: 最大并发数，默认3
        """
        from config.settings import settings
        
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
            from utils.factories import create_ai_analyzer

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

                        # 检查是否需要翻译标题（英文标题翻译成中文）
                        # 放在is_processed检查之前，确保即使是已分析的文章也能翻译
                        if not article_obj.title_zh:
                            import re

                            # 简单判断是否为英文：检查是否包含中文字符
                            def is_english(text: str) -> bool:
                                if not text:
                                    return False
                                chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
                                return chinese_chars / len(text) < 0.3

                            if is_english(article_obj.title):
                                logger.info(f"  🌐 翻译标题: {article_obj.title[:50]}...")
                                try:
                                    article_obj.title_zh = thread_ai_analyzer.translate_title(article_obj.title)
                                    article_session.commit()
                                except Exception as e:
                                    logger.warning(f"  ⚠️  标题翻译失败: {e}")
                                    article_session.rollback()

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

                        # AI分析（使用线程独立的AI分析器）
                        result = thread_ai_analyzer.analyze_article(article_dict)

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
        from utils.factories import create_ai_analyzer

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

                    # AI分析（使用线程独立的AI分析器）
                    result = thread_ai_analyzer.analyze_article(article_dict)

                    # 更新文章
                    article_obj.summary = result.get("summary")
                    article_obj.topics = result.get("topics")
                    article_obj.tags = result.get("tags")
                    article_obj.importance = result.get("importance")
                    article_obj.target_audience = result.get("target_audience")
                    article_obj.key_points = result.get("key_points")
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
