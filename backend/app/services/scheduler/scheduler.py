"""
定时任务调度器 - 使用APScheduler BackgroundScheduler（适配FastAPI）
"""
import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv

from backend.app.core.settings import settings
from backend.app.db import get_db
from backend.app.db.models import Article, ExplorationTask
from backend.app.services.collector import CollectionService
from backend.app.services.exploration import get_exploration_service
from backend.app.utils import create_ai_analyzer, setup_logger

# 加载环境变量
load_dotenv()

logger = setup_logger(__name__)

_scheduler_instance: Optional["TaskScheduler"] = None


def set_scheduler_instance(scheduler: "TaskScheduler") -> None:
    global _scheduler_instance
    _scheduler_instance = scheduler


def reload_scheduler_ai_analyzer() -> None:
    """保存 LLM 配置后热重载调度器中的 AI 分析器（避免仍使用旧模型）"""
    if _scheduler_instance is not None:
        _scheduler_instance.reload_ai_analyzer()


class TaskScheduler:
    """任务调度器（使用BackgroundScheduler，适配FastAPI）"""

    def __init__(self):
        # 使用 BackgroundScheduler 而不是 BlockingScheduler
        # BackgroundScheduler 在后台线程运行，不会阻塞主线程
        self.scheduler = BackgroundScheduler()
        
        # 初始化服务
        self._init_services()

    def _init_services(self):
        """初始化各个服务"""
        self.ai_analyzer = create_ai_analyzer()
        if self.ai_analyzer:
            logger.info("✅ AI分析器初始化成功")
        else:
            logger.warning("⚠️  未配置OPENAI_API_KEY，AI分析功能将不可用")

        # 采集服务
        self.collector = CollectionService(ai_analyzer=self.ai_analyzer)
        logger.info("✅ 采集服务初始化成功")

        # 通知服务（如果存在）
        try:
            from backend.app.services.notification import NotificationService
            # 从数据库加载通知配置
            settings.load_settings_from_db()
            
            webhook_url = settings.NOTIFICATION_WEBHOOK_URL
            platform = settings.NOTIFICATION_PLATFORM
            secret = settings.NOTIFICATION_SECRET
            
            if webhook_url:
                self.notifier = NotificationService(
                    platform=platform,
                    webhook_url=webhook_url,
                    secret=secret
                )
                logger.info(f"✅ 通知服务初始化成功（平台: {platform}）")
            else:
                self.notifier = None
                logger.warning("⚠️  未配置通知Webhook URL，推送功能将不可用")
        except ImportError as e:
            self.notifier = None
            logger.warning(f"⚠️  通知服务模块未找到，推送功能将不可用: {e}")
        except Exception as e:
            self.notifier = None
            logger.warning(f"⚠️  通知服务初始化失败: {e}")

        # 数据库
        self.db = get_db()
        logger.info("✅ 数据库初始化成功")

    def reload_ai_analyzer(self) -> None:
        """从数据库重新加载 LLM 配置并更新采集服务使用的分析器"""
        self.ai_analyzer = create_ai_analyzer(force_new=True)
        self.collector = CollectionService(ai_analyzer=self.ai_analyzer)
        if self.ai_analyzer:
            logger.info(f"✅ AI分析器已热重载，当前模型: {self.ai_analyzer.model}")
        else:
            logger.warning("⚠️  AI分析器热重载失败，未配置有效 LLM")

    def add_collection_job(self, interval_hours: int = None):
        """
        添加定时采集任务（使用间隔时间）

        Args:
            interval_hours: 采集间隔（小时），默认从配置读取
        """
        if interval_hours is None:
            interval_hours = settings.get_auto_collection_interval_hours()
            if interval_hours is None:
                # 如果自动采集未启用，使用默认的 COLLECTION_INTERVAL_HOURS
                interval_hours = settings.COLLECTION_INTERVAL_HOURS
        
        try:
            if interval_hours <= 0:
                raise ValueError(f"无效的采集间隔: {interval_hours} 小时")

            self.scheduler.add_job(
                func=self._run_collection,
                trigger=IntervalTrigger(hours=interval_hours),
                id="collection_job",
                name="定时数据采集",
                replace_existing=True,
            )

            logger.info(f"✅ 定时采集任务已添加: 每 {interval_hours} 小时执行一次")

        except Exception as e:
            logger.error(f"❌ 添加定时采集任务失败: {e}")

    def add_daily_summary_job(self, cron_expression: str = None):
        """
        添加每日摘要任务

        Args:
            cron_expression: cron表达式，默认从配置读取
        """
        if cron_expression is None:
            cron_expression = settings.get_daily_summary_cron()
            if not cron_expression:
                logger.warning("⚠️  每日总结未启用或配置无效")
                return
        
        try:
            self.scheduler.add_job(
                func=self._run_daily_summary,
                trigger=CronTrigger.from_crontab(cron_expression),
                id="daily_summary_job",
                name="每日摘要生成",
                replace_existing=True,
            )

            logger.info(f"✅ 每日摘要任务已添加: {cron_expression}")

        except Exception as e:
            logger.error(f"❌ 添加每日摘要任务失败: {e}")

    def add_weekly_summary_job(self, cron_expression: str = None):
        """
        添加每周摘要任务

        Args:
            cron_expression: cron表达式，默认从配置读取
        """
        if cron_expression is None:
            cron_expression = settings.get_weekly_summary_cron()
            if not cron_expression:
                logger.warning("⚠️  每周总结未启用或配置无效")
                return
        
        try:
            self.scheduler.add_job(
                func=self._run_weekly_summary,
                trigger=CronTrigger.from_crontab(cron_expression),
                id="weekly_summary_job",
                name="每周摘要推送",
                replace_existing=True,
            )

            logger.info(f"✅ 每周摘要任务已添加: {cron_expression}")

        except Exception as e:
            logger.error(f"❌ 添加每周摘要任务失败: {e}")

    def add_social_media_report_job(self, cron_expression: str = None):
        """
        添加社交平台AI小报定时生成任务

        Args:
            cron_expression: cron表达式，默认从配置读取
        """
        if cron_expression is None:
            cron_expression = settings.get_social_media_auto_report_cron()
            if not cron_expression:
                logger.warning("⚠️  社交平台定时生成AI小报未启用或配置无效")
                return
        
        try:
            self.scheduler.add_job(
                func=self._run_social_media_report,
                trigger=CronTrigger.from_crontab(cron_expression),
                id="social_media_report_job",
                name="社交平台AI小报生成",
                replace_existing=True,
            )

            logger.info(f"✅ 社交平台AI小报定时生成任务已添加: {cron_expression}")

        except Exception as e:
            logger.error(f"❌ 添加社交平台AI小报定时生成任务失败: {e}")

    def add_exploration_job(self, cron_expression: str = None):
        """
        添加自主探索定时任务
        """
        try:
            exploration_service = get_exploration_service()
            config = exploration_service.get_runtime_config()
            auto_enabled = bool(config.get("auto_monitor_enabled"))
            interval_hours = int(config.get("auto_monitor_interval_hours") or 24)

            if not auto_enabled:
                logger.warning("⚠️  自主探索定时任务未启用")
                return

            if cron_expression:
                trigger = CronTrigger.from_crontab(cron_expression)
                trigger_desc = cron_expression
            else:
                interval_hours = max(1, min(168, interval_hours))
                trigger = IntervalTrigger(hours=interval_hours)
                trigger_desc = f"every {interval_hours}h"

            self.scheduler.add_job(
                func=self._run_exploration,
                trigger=trigger,
                id="exploration_job",
                name="自主探索模型发现",
                replace_existing=True,
            )
            logger.info(f"✅ 自主探索定时任务已添加: {trigger_desc}")
        except Exception as e:
            logger.error(f"❌ 添加自主探索定时任务失败: {e}")

    def _run_collection(self):
        """执行采集任务（自动定时采集）"""
        task_id = None
        try:
            logger.info("=" * 60)
            logger.info("🚀 开始执行定时采集任务")
            logger.info(f"⏰ 时间: {datetime.now()}")
            logger.info(f"📋 任务ID: collection_job")
            logger.info(f"🔄 采集间隔: 每 {settings.get_auto_collection_interval_hours() or settings.COLLECTION_INTERVAL_HOURS} 小时")

            # 创建采集任务记录（与手动采集保持一致）
            from backend.app.db.models import CollectionTask
            with self.db.get_session() as session:
                task = CollectionTask(
                    status="running",
                    ai_enabled=True,  # 定时采集默认启用AI分析
                    started_at=datetime.now(),
                )
                session.add(task)
                session.commit()
                session.refresh(task)
                task_id = task.id
                logger.info(f"📝 已创建采集任务记录 (ID: {task_id})")

            # 执行采集（传递 task_id 以便更新任务进度）
            stats = self.collector.collect_all(enable_ai_analysis=True, task_id=task_id)

            # 更新任务状态为完成
            with self.db.get_session() as session:
                task = session.query(CollectionTask).filter(CollectionTask.id == task_id).first()
                if task:
                    task.status = "completed"
                    task.new_articles_count = stats.get('new_articles', 0)
                    task.total_sources = stats.get('sources_success', 0) + stats.get('sources_error', 0)
                    task.success_sources = stats.get('sources_success', 0)
                    task.failed_sources = stats.get('sources_error', 0)
                    task.duration = stats.get('duration', 0)
                    task.completed_at = datetime.now()
                    task.ai_analyzed_count = stats.get('ai_analyzed_count', 0)
                    session.commit()

            logger.info(f"✅ 采集完成:")
            logger.info(f"   总文章数: {stats['total_articles']}")
            logger.info(f"   新增文章: {stats['new_articles']}")
            logger.info(f"   耗时: {stats['duration']:.2f}秒")
            
            # 显示下次执行时间
            job = self.scheduler.get_job("collection_job")
            if job and job.next_run_time:
                logger.info(f"⏰ 下次执行时间: {job.next_run_time.strftime('%Y-%m-%d %H:%M:%S')}")
            logger.info("=" * 60)

            # 检查是否有高重要性文章需要即时推送
            if self.notifier:
                self._send_instant_alerts()

        except Exception as e:
            logger.error(f"❌ 采集任务执行失败: {e}", exc_info=True)
            
            # 更新任务状态为错误
            if task_id:
                try:
                    from backend.app.db.models import CollectionTask
                    with self.db.get_session() as session:
                        task = session.query(CollectionTask).filter(CollectionTask.id == task_id).first()
                        if task:
                            task.status = "error"
                            task.error_message = str(e)
                            task.completed_at = datetime.now()
                            session.commit()
                except Exception as update_error:
                    logger.error(f"❌ 更新任务状态失败: {update_error}", exc_info=True)

    def _run_daily_summary(self):
        """执行每日摘要任务（生成总结并自动推送）"""
        try:
            logger.info("=" * 60)
            logger.info("📝 开始执行每日摘要任务")
            logger.info(f"⏰ 时间: {datetime.now()}")

            ai_analyzer = create_ai_analyzer(force_new=True)
            if not ai_analyzer:
                logger.warning("⚠️  AI分析器未配置，跳过摘要生成")
                return

            # 使用总结生成器生成每日总结
            # 自动执行时统计昨天的内容
            from backend.app.services.collector.summary_generator import SummaryGenerator
            logger.info(f"🤖 每日摘要使用模型: {ai_analyzer.model}")
            summary_generator = SummaryGenerator(ai_analyzer)
            yesterday = datetime.now() - timedelta(days=1)
            summary_obj = summary_generator.generate_daily_summary(self.db, yesterday)

            if not summary_obj:
                logger.warning("⚠️  昨日暂无符合条件的文章，跳过推送")
                logger.info("=" * 60)
                return

            logger.info("📝 每日摘要生成完成")
            logger.info(f"   文章总数: {summary_obj.total_articles}")
            logger.info(f"   高重要性: {summary_obj.high_importance_count}")
            logger.info(f"   中重要性: {summary_obj.medium_importance_count}")

            # 总结生成完成后，自动触发推送
            if self.notifier and hasattr(self.notifier, 'send_daily_summary'):
                logger.info("📤 开始推送每日摘要...")
                summary_content = summary_obj.summary_content
                success = self.notifier.send_daily_summary(
                    summary_content,
                    self.db,
                    articles_count=summary_obj.total_articles
                )
                if success:
                    logger.info("✅ 每日摘要推送成功")
                else:
                    logger.error("❌ 每日摘要推送失败")
            else:
                if not self.notifier:
                    logger.warning("⚠️  通知服务未配置，跳过推送")
                else:
                    logger.warning("⚠️  通知服务不支持每日摘要推送")

            logger.info("=" * 60)

        except Exception as e:
            logger.error(f"❌ 每日摘要任务执行失败: {e}", exc_info=True)

    def _run_weekly_summary(self):
        """执行每周摘要任务（生成总结并自动推送）"""
        try:
            logger.info("=" * 60)
            logger.info("📝 开始执行每周摘要任务")
            logger.info(f"⏰ 时间: {datetime.now()}")

            ai_analyzer = create_ai_analyzer(force_new=True)
            if not ai_analyzer:
                logger.warning("⚠️  AI分析器未配置，跳过摘要生成")
                return

            # 使用总结生成器生成每周总结
            # 自动执行时统计上周的内容（上周六到上周五）
            # 由于每周总结在周六执行，需要传递上周六的日期
            from backend.app.services.collector.summary_generator import SummaryGenerator
            logger.info(f"🤖 每周摘要使用模型: {ai_analyzer.model}")
            summary_generator = SummaryGenerator(ai_analyzer)
            # 计算上周六的日期
            # 如果今天是周六，上周六是7天前；如果今天是其他日期，计算距离上周六的天数
            now = datetime.now()
            weekday = now.weekday()  # Monday=0, Tuesday=1, ..., Sunday=6
            if weekday == 5:  # 周六
                days_to_last_saturday = 7
            elif weekday == 6:  # 周日
                days_to_last_saturday = 1
            else:  # 周一到周五
                days_to_last_saturday = weekday + 2
            last_saturday = now - timedelta(days=days_to_last_saturday)
            summary_obj = summary_generator.generate_weekly_summary(self.db, last_saturday)

            if not summary_obj:
                logger.warning("⚠️  上周暂无符合条件的文章，跳过推送")
                logger.info("=" * 60)
                return

            logger.info("📝 每周摘要生成完成")
            logger.info(f"   文章总数: {summary_obj.total_articles}")
            logger.info(f"   高重要性: {summary_obj.high_importance_count}")
            logger.info(f"   中重要性: {summary_obj.medium_importance_count}")

            # 总结生成完成后，自动触发推送
            if self.notifier and hasattr(self.notifier, 'send_weekly_summary'):
                logger.info("📤 开始推送每周摘要...")
                summary_content = summary_obj.summary_content
                success = self.notifier.send_weekly_summary(
                    summary_content,
                    self.db,
                    articles_count=summary_obj.total_articles
                )
                if success:
                    logger.info("✅ 每周摘要推送成功")
                else:
                    logger.error("❌ 每周摘要推送失败")
            else:
                if not self.notifier:
                    logger.warning("⚠️  通知服务未配置，跳过推送")
                else:
                    logger.warning("⚠️  通知服务不支持每周摘要推送")

            logger.info("=" * 60)

        except Exception as e:
            logger.error(f"❌ 每周摘要任务执行失败: {e}", exc_info=True)

    def _run_social_media_report(self):
        """执行社交平台AI小报生成任务"""
        try:
            logger.info("=" * 60)
            logger.info("📰 开始执行社交平台AI小报生成任务")
            logger.info(f"⏰ 时间: {datetime.now()}")

            # 导入社交平台采集器和报告生成器
            from backend.app.services.social_media import SocialMediaCollector
            from backend.app.core.settings import settings
            
            # 重新加载配置
            settings.load_social_media_settings()
            
            # 初始化采集器
            collector = SocialMediaCollector()
            youtube_key = settings.YOUTUBE_API_KEY
            twitter_key = settings.TWITTER_API_KEY
            tiktok_key = settings.TIKTOK_API_KEY
            reddit_client_id = settings.REDDIT_CLIENT_ID
            reddit_client_secret = settings.REDDIT_CLIENT_SECRET
            reddit_user_agent = settings.REDDIT_USER_AGENT

            collector.initialize(
                youtube_api_key=youtube_key,
                twitter_api_key=twitter_key,
                tiktok_api_key=tiktok_key,
                reddit_client_id=reddit_client_id,
                reddit_client_secret=reddit_client_secret,
                reddit_user_agent=reddit_user_agent
            )

            if not collector.report_generator:
                logger.warning("⚠️  报告生成器未初始化，跳过生成")
                return

            # 检查哪些平台已配置
            youtube_enabled = collector.youtube_collector is not None
            tiktok_enabled = collector.tiktok_collector is not None
            twitter_enabled = collector.twitter_collector is not None
            reddit_enabled = collector.reddit_collector is not None

            if not any([youtube_enabled, tiktok_enabled, twitter_enabled, reddit_enabled]):
                logger.warning("⚠️  没有已配置的社交平台，跳过生成")
                return

            # 采集数据
            from datetime import timedelta
            published_after = datetime.now() - timedelta(days=1)
            
            results = {
                "youtube": [],
                "tiktok": [],
                "twitter": [],
                "reddit": []
            }

            # YouTube采集
            if youtube_enabled:
                try:
                    youtube_videos = collector.youtube_collector.search_videos(
                        query="AI",
                        published_after=published_after,
                        max_results=50,
                    )
                    results["youtube"] = youtube_videos
                except Exception as e:
                    logger.error(f"YouTube采集失败: {e}")

            # TikTok采集
            if tiktok_enabled:
                try:
                    tiktok_videos = collector.tiktok_collector.search_videos(
                        keyword="AI",
                        min_viral_score=8.0,
                        max_days=1,
                        max_results=50,
                    )
                    results["tiktok"] = tiktok_videos
                except Exception as e:
                    logger.error(f"TikTok采集失败: {e}")

            # Twitter采集
            if twitter_enabled:
                try:
                    twitter_tweets = collector.twitter_collector.search_tweets(
                        query="AI",
                        query_type="Top",
                        min_view_count=10000,
                        min_engagement_score=1000,
                        max_results=50,
                    )
                    results["twitter"] = twitter_tweets
                except Exception as e:
                    logger.error(f"Twitter采集失败: {e}")

            # Reddit采集
            if reddit_enabled:
                try:
                    reddit_posts = collector.reddit_collector.search_posts(
                        subreddits=["ArtificialInteligence", "artificial"],
                        category="hot",
                        time_range="day",
                        min_upvotes=50,
                        max_results=50,
                    )
                    results["reddit"] = reddit_posts
                except Exception as e:
                    logger.error(f"Reddit采集失败: {e}")

            # 汇总采集数据
            all_posts = []
            for platform, posts in results.items():
                all_posts.extend(posts)

            if not all_posts:
                logger.warning("⚠️  未采集到任何数据，跳过生成")
                return

            # 将字典转换为SocialMediaPost对象（临时对象）
            temp_posts = []
            for post_data in all_posts:
                try:
                    from backend.app.db.models import SocialMediaPost
                    temp_post = SocialMediaPost(**post_data)
                    temp_posts.append(temp_post)
                except Exception as e:
                    logger.warning(f"转换帖子数据失败: {e}")
                    continue

            if not temp_posts:
                logger.warning("⚠️  转换帖子数据失败，跳过生成")
                return

            # 保存到数据库（作为缓存）
            saved_post_ids = []
            with self.db.get_session() as session:
                saved_posts = collector.save_posts(session, all_posts)
                saved_post_ids = [post.id for post in saved_posts]

            # 从数据库加载已有的翻译和价值判断结果，填充到临时对象中
            post_ids_by_platform = {}
            for temp_post in temp_posts:
                if temp_post.post_id:
                    platform = temp_post.platform
                    if platform not in post_ids_by_platform:
                        post_ids_by_platform[platform] = []
                    post_ids_by_platform[platform].append(temp_post.post_id)

            # 批量查询已有的翻译和价值判断结果
            if post_ids_by_platform:
                with self.db.get_session() as session:
                    for platform, post_ids in post_ids_by_platform.items():
                        existing_posts = session.query(SocialMediaPost).filter(
                            SocialMediaPost.platform == platform,
                            SocialMediaPost.post_id.in_(post_ids)
                        ).all()
                        
                        existing_posts_map = {p.post_id: p for p in existing_posts}
                        
                        for temp_post in temp_posts:
                            if temp_post.platform == platform and temp_post.post_id in existing_posts_map:
                                existing_post = existing_posts_map[temp_post.post_id]
                                if existing_post.title_zh:
                                    temp_post.title_zh = existing_post.title_zh
                                if existing_post.has_value is not None:
                                    temp_post.has_value = existing_post.has_value

            # AI分析(后台执行) - 只对新保存的帖子进行分析
            if saved_post_ids:
                import threading
                threading.Thread(
                    target=self._analyze_posts,
                    args=(collector, saved_post_ids),
                    name="social-media-post-analyzer",
                    daemon=True,
                ).start()

            # 生成报告
            report_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            with self.db.get_session() as session:
                report = collector.report_generator.generate_daily_report(
                    db=session,
                    posts=temp_posts,
                    report_date=report_date,
                    youtube_enabled=youtube_enabled,
                    tiktok_enabled=tiktok_enabled,
                    twitter_enabled=twitter_enabled,
                    reddit_enabled=reddit_enabled,
                )

            if report:
                logger.info("✅ 社交平台AI小报生成完成")
                logger.info(f"   YouTube: {report.youtube_count}条")
                logger.info(f"   TikTok: {report.tiktok_count}条")
                logger.info(f"   Twitter: {report.twitter_count}条")
                logger.info(f"   Reddit: {report.reddit_count}条")
                logger.info(f"   总计: {report.total_count}条")
            else:
                logger.warning("⚠️  生成报告失败，数据可能为空")

            logger.info("=" * 60)

        except Exception as e:
            logger.error(f"❌ 社交平台AI小报生成任务执行失败: {e}", exc_info=True)

    def _run_exploration(self):
        """执行自主探索任务"""
        task_id = f"explore-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8]}"
        try:
            logger.info("=" * 60)
            logger.info("🔭 开始执行自主探索定时任务")
            logger.info(f"⏰ 时间: {datetime.now()}")
            logger.info(f"📋 任务ID: {task_id}")

            exploration_service = get_exploration_service()
            config = exploration_service.get_runtime_config()
            sources = config.get("monitor_sources") or ["github", "huggingface", "arxiv", "modelscope"]
            watch_organizations = config.get("watch_organizations") or []
            min_score = float(config.get("min_score") or 70.0)
            days_back = int(config.get("days_back") or 2)
            max_results_per_source = int(config.get("max_results_per_source") or 30)
            run_mode = str(config.get("run_mode") or "auto")

            with self.db.get_session() as session:
                stale_count = 0
                now = datetime.now()
                for existing_task in (
                    session.query(ExplorationTask)
                    .filter(ExplorationTask.status.in_(("pending", "running")))
                    .all()
                ):
                    reference_time = (
                        existing_task.start_time
                        or existing_task.created_at
                        or existing_task.discovery_time
                    )
                    if not reference_time:
                        continue
                    elapsed_seconds = (now - reference_time).total_seconds()
                    timeout_seconds = 6 * 3600 if existing_task.status == "running" else 30 * 60
                    if elapsed_seconds < timeout_seconds:
                        continue
                    existing_task.status = "failed"
                    existing_task.end_time = now
                    existing_task.error_message = "任务长时间未完成，已自动标记为失败（可能服务重启导致中断）"
                    stale_count += 1

                if stale_count > 0:
                    session.flush()
                    logger.warning("⚠️  自动清理过期探索任务 count=%s", stale_count)

                active_task = (
                    session.query(ExplorationTask)
                    .filter(
                        ExplorationTask.status.in_(("pending", "running")),
                        ExplorationTask.source != "manual-report",
                    )
                    .order_by(ExplorationTask.created_at.desc())
                    .first()
                )
                if active_task:
                    logger.info(
                        "⏭️  已有探索任务执行中，跳过本次自动任务 task_id=%s",
                        active_task.task_id,
                    )
                    return

                task = ExplorationTask(
                    task_id=task_id,
                    status="pending",
                    source=",".join(sources),
                    model_name="pending",
                    discovery_time=datetime.now(),
                    progress={
                        "current_stage": "queued",
                        "models_discovered": 0,
                        "models_evaluated": 0,
                        "updates_detected": 0,
                        "release_candidates": 0,
                        "notable_models": 0,
                        "reports_generated": 0,
                        "source_results": {},
                    },
                )
                session.add(task)
                session.flush()

            exploration_service.run_task(
                task_id=task_id,
                sources=sources,
                min_score=min_score,
                days_back=days_back,
                max_results_per_source=max_results_per_source,
                keywords=["LLM", "transformer", "multimodal", "diffusion"],
                watch_organizations=watch_organizations,
                run_mode=run_mode,
            )

            logger.info("✅ 自主探索定时任务执行完成")
            logger.info("=" * 60)
        except Exception as e:
            logger.error(f"❌ 自主探索定时任务执行失败: {e}", exc_info=True)

    def _analyze_posts(self, collector, post_ids):
        """后台分析帖子"""
        try:
            from backend.app.db import get_db
            db = get_db()
            with db.get_session() as session:
                from backend.app.db.models import SocialMediaPost
                posts = session.query(SocialMediaPost).filter(SocialMediaPost.id.in_(post_ids)).all()
                collector.analyze_posts(session, posts)
        except Exception as e:
            logger.error(f"异步分析失败: {e}")

    def _send_instant_alerts(self):
        """发送即时提醒（高重要性文章）"""
        try:
            with self.db.get_session() as session:
                # 获取最近1小时的高重要性文章且未推送的
                time_threshold = datetime.now() - timedelta(hours=1)

                articles = (
                    session.query(Article)
                    .filter(
                        Article.published_at >= time_threshold,
                        Article.importance == "high",
                        Article.is_sent == False
                    )
                    .all()
                )

                if not articles:
                    return

                logger.info(f"🚨 发现 {len(articles)} 篇高重要性文章，准备推送")

                # 检查是否启用了即时通知
                if not settings.INSTANT_NOTIFICATION_ENABLED:
                    logger.info("⚠️  即时通知未启用，跳过推送")
                    return

                for article in articles:
                    if self.notifier and hasattr(self.notifier, 'send_instant_alert'):
                        success = self.notifier.send_instant_alert(article, db=session)
                        if success:
                            article.is_sent = True
                            logger.info(f"✅ 已推送: {article.title[:50]}...")
                        else:
                            logger.error(f"❌ 推送失败: {article.title[:50]}...")

                session.commit()

        except Exception as e:
            logger.error(f"❌ 发送即时提醒失败: {e}", exc_info=True)

    def start(self):
        """启动调度器"""
        try:
            logger.info("🚀 任务调度器启动中...")
            logger.info(f"📅 当前时间: {datetime.now()}")
            logger.info(f"📊 自动采集状态: {'已启用' if settings.AUTO_COLLECTION_ENABLED else '未启用'}")

            # 添加任务
            # 如果启用了自动采集，使用自动采集间隔；否则使用默认的COLLECTION_INTERVAL_HOURS
            if settings.AUTO_COLLECTION_ENABLED:
                interval_hours = settings.get_auto_collection_interval_hours()
                if interval_hours:
                    logger.info(f"⏰ 使用自动采集间隔: 每 {interval_hours} 小时执行一次")
                    self.add_collection_job(interval_hours)
                else:
                    logger.warning("⚠️  自动采集间隔配置无效，使用默认配置")
                    self.add_collection_job()
            else:
                # 即使未启用自动采集，也可以使用默认间隔（如果需要）
                logger.info(f"⏰ 自动采集未启用，使用默认间隔: 每 {settings.COLLECTION_INTERVAL_HOURS} 小时")
                # 注意：如果不需要，可以注释掉下面这行
                # self.add_collection_job()
            
            # 添加总结任务
            if settings.DAILY_SUMMARY_ENABLED:
                self.add_daily_summary_job()
            
            if settings.WEEKLY_SUMMARY_ENABLED:
                self.add_weekly_summary_job()
            
            # 添加社交平台AI小报生成任务
            # 强制重新加载配置，确保获取最新值
            settings.load_social_media_settings()
            logger.info(f"📊 社交平台AI小报定时生成状态: {'已启用' if settings.SOCIAL_MEDIA_AUTO_REPORT_ENABLED else '未启用'}")
            if settings.SOCIAL_MEDIA_AUTO_REPORT_ENABLED:
                logger.info(f"⏰ 定时生成时间: {settings.SOCIAL_MEDIA_AUTO_REPORT_TIME}")
                self.add_social_media_report_job()
            else:
                logger.info("ℹ️  社交平台AI小报定时生成未启用，跳过添加任务")

            # 添加自主探索任务
            exploration_service = get_exploration_service()
            exploration_config = exploration_service.get_runtime_config()
            logger.info(
                f"🔭 自主探索定时任务状态: {'已启用' if exploration_config.get('auto_monitor_enabled') else '未启用'}"
            )
            if exploration_config.get("auto_monitor_enabled"):
                logger.info(f"⏰ 自主探索执行间隔: 每 {exploration_config.get('auto_monitor_interval_hours', 24)} 小时")
                self.add_exploration_job()
            else:
                logger.info("ℹ️  自主探索定时任务未启用，跳过添加任务")

            # 启动调度器（BackgroundScheduler 在后台运行）
            self.scheduler.start()

            # 显示即将执行的任务
            jobs = self.scheduler.get_jobs()
            if jobs:
                logger.info(f"📋 已注册 {len(jobs)} 个定时任务:")
                for job in jobs:
                    next_run = job.next_run_time.strftime("%Y-%m-%d %H:%M:%S") if job.next_run_time else "未计划"
                    logger.info(f"   - {job.name} (ID: {job.id})")
                    logger.info(f"     下次执行: {next_run}")
            else:
                logger.warning("⚠️  调度器已启动，但未找到任何定时任务")

            logger.info("✅ 任务调度器已启动（后台运行）")

        except Exception as e:
            logger.error(f"❌ 调度器启动失败: {e}", exc_info=True)

    def shutdown(self):
        """关闭调度器"""
        try:
            logger.info("⏹️  正在关闭调度器...")
            self.scheduler.shutdown(wait=True)
            logger.info("✅ 调度器已关闭")
        except Exception as e:
            logger.error(f"❌ 关闭调度器失败: {e}", exc_info=True)


def create_scheduler() -> TaskScheduler:
    """创建并配置调度器实例"""
    scheduler = TaskScheduler()
    set_scheduler_instance(scheduler)
    scheduler.start()
    return scheduler



