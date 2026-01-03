"""
定时任务调度器 - 使用APScheduler BackgroundScheduler（适配FastAPI）
"""
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
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
        # AI分析器
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
            from notification import NotificationService
            feishu_webhook = os.getenv("FEISHU_BOT_WEBHOOK") or settings.FEISHU_BOT_WEBHOOK
            if feishu_webhook:
                self.notifier = NotificationService(feishu_webhook=feishu_webhook)
                logger.info("✅ 通知服务初始化成功")
            else:
                self.notifier = None
                logger.warning("⚠️  未配置FEISHU_BOT_WEBHOOK，推送功能将不可用")
        except ImportError:
            self.notifier = None
            logger.warning("⚠️  通知服务模块未找到，推送功能将不可用")

        # 数据库
        self.db = get_db()
        logger.info("✅ 数据库初始化成功")

    def add_collection_job(self, cron_expression: str = None):
        """
        添加定时采集任务

        Args:
            cron_expression: cron表达式，默认从配置读取
        """
        if cron_expression is None:
            cron_expression = settings.COLLECTION_CRON
        
        try:
            # 解析cron表达式
            # 格式: 分 时 日 月 周
            parts = cron_expression.split()
            if len(parts) != 5:
                raise ValueError(f"无效的cron表达式: {cron_expression}")

            self.scheduler.add_job(
                func=self._run_collection,
                trigger=CronTrigger.from_crontab(cron_expression),
                id="collection_job",
                name="定时数据采集",
                replace_existing=True,
            )

            logger.info(f"✅ 定时采集任务已添加: {cron_expression}")

        except Exception as e:
            logger.error(f"❌ 添加定时采集任务失败: {e}")

    def add_daily_summary_job(self, cron_expression: str = None):
        """
        添加每日摘要任务

        Args:
            cron_expression: cron表达式，默认从配置读取
        """
        if cron_expression is None:
            cron_expression = settings.DAILY_SUMMARY_CRON
        
        try:
            self.scheduler.add_job(
                func=self._run_daily_summary,
                trigger=CronTrigger.from_crontab(cron_expression),
                id="daily_summary_job",
                name="每日摘要推送",
                replace_existing=True,
            )

            logger.info(f"✅ 每日摘要任务已添加: {cron_expression}")

        except Exception as e:
            logger.error(f"❌ 添加每日摘要任务失败: {e}")

    def _run_collection(self):
        """执行采集任务"""
        try:
            logger.info("=" * 60)
            logger.info("🚀 开始执行定时采集任务")
            logger.info(f"⏰ 时间: {datetime.now()}")

            stats = self.collector.collect_all(enable_ai_analysis=True)

            logger.info(f"✅ 采集完成:")
            logger.info(f"   总文章数: {stats['total_articles']}")
            logger.info(f"   新增文章: {stats['new_articles']}")
            logger.info(f"   耗时: {stats['duration']:.2f}秒")
            logger.info("=" * 60)

            # 检查是否有高重要性文章需要即时推送
            if self.notifier:
                self._send_instant_alerts()

        except Exception as e:
            logger.error(f"❌ 采集任务执行失败: {e}", exc_info=True)

    def _run_daily_summary(self):
        """执行每日摘要任务"""
        try:
            logger.info("=" * 60)
            logger.info("📝 开始执行每日摘要任务")
            logger.info(f"⏰ 时间: {datetime.now()}")

            if not self.ai_analyzer:
                logger.warning("⚠️  AI分析器未配置，跳过摘要生成")
                return

            if not self.notifier:
                logger.warning("⚠️  通知服务未配置，跳过推送")
                return

            # 获取重要文章（使用数据库查询）
            with self.db.get_session() as session:
                from backend.app.db.repositories import ArticleRepository
                
                # 获取最近24小时的高重要性文章
                time_threshold = datetime.now() - timedelta(days=1)
                articles = ArticleRepository.get_articles_by_filters(
                    session=session,
                    time_threshold=time_threshold,
                    importance_values=["high", "medium"],
                    limit=20
                )

            if not articles:
                logger.info("📭 今日暂无重要文章")
                return

            logger.info(f"📊 找到 {len(articles)} 篇重要文章")

            # 准备文章数据
            articles_data = []
            for article in articles:
                articles_data.append(
                    {
                        "title": article.title,
                        "content": article.content,
                        "source": article.source,
                        "published_at": article.published_at,
                        "summary": article.summary,
                        "importance": article.importance,
                    }
                )

            # 生成摘要（如果AI分析器有这个方法）
            # 注意：这里需要根据实际的 AIAnalyzer 接口调整
            if hasattr(self.ai_analyzer, 'generate_daily_summary'):
                summary = self.ai_analyzer.generate_daily_summary(articles_data, max_count=15)
            else:
                # 如果没有这个方法，使用总结生成器
                from backend.app.services.collector.summary_generator import SummaryGenerator
                summary_generator = SummaryGenerator(self.ai_analyzer)
                summary_obj = summary_generator.generate_daily_summary(self.db)
                summary = summary_obj.summary_content if summary_obj else "暂无摘要"

            logger.info("📝 摘要生成完成")
            logger.info(f"\n{summary[:500]}...\n")

            # 推送到飞书
            if self.notifier and hasattr(self.notifier, 'send_daily_summary'):
                success = self.notifier.send_daily_summary(summary, self.db, limit=20)
                if success:
                    logger.info("✅ 每日摘要推送成功")
                else:
                    logger.error("❌ 每日摘要推送失败")
            else:
                logger.warning("⚠️  通知服务不支持每日摘要推送")

            logger.info("=" * 60)

        except Exception as e:
            logger.error(f"❌ 每日摘要任务执行失败: {e}", exc_info=True)

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

                for article in articles:
                    if self.notifier and hasattr(self.notifier, 'send_instant_alert'):
                        success = self.notifier.send_instant_alert(article)
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

            # 添加任务
            self.add_collection_job()
            self.add_daily_summary_job()

            # 启动调度器（BackgroundScheduler 在后台运行）
            self.scheduler.start()

            # 显示即将执行的任务
            self.scheduler.print_jobs()

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



