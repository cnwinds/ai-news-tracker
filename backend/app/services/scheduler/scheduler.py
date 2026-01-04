"""
定时任务调度器 - 使用APScheduler BackgroundScheduler（适配FastAPI）
"""
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime, timedelta
import logging
import sys
from pathlib import Path
import os
from dotenv import load_dotenv

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.app.services.collector import CollectionService
from backend.app.db import get_db
from backend.app.db.models import Article
from backend.app.utils import create_ai_analyzer, setup_logger
from backend.app.core.settings import settings

# 加载环境变量
load_dotenv()

logger = setup_logger(__name__)


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

    def _run_collection(self):
        """执行采集任务"""
        try:
            logger.info("=" * 60)
            logger.info("🚀 开始执行定时采集任务")
            logger.info(f"⏰ 时间: {datetime.now()}")
            logger.info(f"📋 任务ID: collection_job")
            logger.info(f"🔄 采集间隔: 每 {settings.get_auto_collection_interval_hours() or settings.COLLECTION_INTERVAL_HOURS} 小时")

            stats = self.collector.collect_all(enable_ai_analysis=True)

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

    def _run_daily_summary(self):
        """执行每日摘要任务（生成总结并自动推送）"""
        try:
            logger.info("=" * 60)
            logger.info("📝 开始执行每日摘要任务")
            logger.info(f"⏰ 时间: {datetime.now()}")

            if not self.ai_analyzer:
                logger.warning("⚠️  AI分析器未配置，跳过摘要生成")
                return

            # 使用总结生成器生成每日总结
            # 自动执行时统计昨天的内容
            from backend.app.services.collector.summary_generator import SummaryGenerator
            summary_generator = SummaryGenerator(self.ai_analyzer)
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
                logger.info("📤 开始推送每日摘要到飞书...")
                summary_content = summary_obj.summary_content
                success = self.notifier.send_daily_summary(summary_content, self.db, limit=20)
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

            if not self.ai_analyzer:
                logger.warning("⚠️  AI分析器未配置，跳过摘要生成")
                return

            # 使用总结生成器生成每周总结
            # 自动执行时统计上周的内容（上周六到上周五）
            # 由于每周总结在周六执行，需要传递上周六的日期
            from backend.app.services.collector.summary_generator import SummaryGenerator
            summary_generator = SummaryGenerator(self.ai_analyzer)
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
            if self.notifier and hasattr(self.notifier, 'send_daily_summary'):
                logger.info("📤 开始推送每周摘要到飞书...")
                summary_content = summary_obj.summary_content
                success = self.notifier.send_daily_summary(summary_content, self.db, limit=20)
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
    scheduler.start()
    return scheduler



