"""
通知服务 - 管理各种推送方式
"""
from typing import List, Any
from datetime import datetime
import logging

from notification.feishu_notifier import FeishuNotifier, format_articles_for_feishu
from database import get_db
from database.models import Article, NotificationLog

logger = logging.getLogger(__name__)


class NotificationService:
    """通知服务"""

    def __init__(self, feishu_webhook: str = None, feishu_app_id: str = None, feishu_app_secret: str = None):
        self.feishu = FeishuNotifier(webhook_url=feishu_webhook, app_id=feishu_app_id, app_secret=feishu_app_secret)

    def send_daily_summary(self, summary: str, db, limit: int = 10) -> bool:
        """
        发送每日摘要

        Args:
            summary: 摘要文本
            db: 数据库实例
            limit: 最大文章数

        Returns:
            是否发送成功
        """
        try:
            logger.info("📤 正在发送每日摘要到飞书")

            # 获取最近的重要文章
            articles = self._get_daily_articles(db, limit)

            if not articles:
                logger.warning("⚠️  没有重要文章可推送")
                return False

            # 格式化文章
            formatted_articles = format_articles_for_feishu(articles)

            # 发送到飞书
            success = self.feishu.send_daily_summary(summary, formatted_articles)

            # 记录日志
            self._log_notification("daily_summary", "feishu", success, len(articles))

            if success:
                # 更新文章推送状态
                self._mark_articles_as_sent(db, articles)

            return success

        except Exception as e:
            logger.error(f"❌ 发送每日摘要失败: {e}")
            self._log_notification("daily_summary", "feishu", False, 0, str(e))
            return False

    def send_instant_alert(self, article: Article) -> bool:
        """
        发送即时提醒（高重要性文章）

        Args:
            article: 文章对象

        Returns:
            是否发送成功
        """
        try:
            logger.info(f"🚨 发送即时提醒: {article.title[:50]}...")

            # 格式化文章
            formatted_article = {
                "title": article.title,
                "url": article.url,
                "source": article.source,
                "published_at": article.published_at.strftime("%Y-%m-%d %H:%M") if article.published_at else "",
                "summary": article.summary,
                "importance": article.importance,
            }

            # 发送到飞书
            success = self.feishu.send_instant_notification(formatted_article)

            # 记录日志
            self._log_notification("instant", "feishu", success, 1)

            return success

        except Exception as e:
            logger.error(f"❌ 发送即时提醒失败: {e}")
            self._log_notification("instant", "feishu", False, 0, str(e))
            return False

    def _get_daily_articles(self, db, limit: int = 10) -> List[Article]:
        """获取每日重要文章"""
        with db.get_session() as session:
            from datetime import timedelta

            time_threshold = datetime.now() - timedelta(hours=24)

            articles = (
                session.query(Article)
                .filter(Article.published_at >= time_threshold, Article.importance.in_(["high", "medium"]), Article.is_sent == False)
                .order_by(Article.published_at.desc())
                .limit(limit)
                .all()
            )

            return articles

    def _mark_articles_as_sent(self, db, articles: List[Article]):
        """标记文章为已推送"""
        try:
            with db.get_session() as session:
                article_ids = [a.id for a in articles]

                session.query(Article).filter(Article.id.in_(article_ids)).update({"is_sent": True}, synchronize_session=False)

                session.commit()

        except Exception as e:
            logger.error(f"❌ 更新推送状态失败: {e}")

    def _log_notification(self, notification_type: str, platform: str, status: bool, count: int, error: str = None):
        """记录通知日志"""
        try:
            db = get_db()
            with db.get_session() as session:
                log = NotificationLog(
                    notification_type=notification_type,
                    platform=platform,
                    status="success" if status else "error",
                    articles_count=count,
                    error_message=error,
                )
                session.add(log)
                session.commit()

        except Exception as e:
            logger.error(f"❌ 记录通知日志失败: {e}")
