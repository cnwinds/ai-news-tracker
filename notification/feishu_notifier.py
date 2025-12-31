"""
飞书机器人通知服务
"""
import requests
from typing import List, Dict, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class FeishuNotifier:
    """飞书通知器"""

    def __init__(self, webhook_url: str = None, app_id: str = None, app_secret: str = None):
        self.webhook_url = webhook_url
        self.app_id = app_id
        self.app_secret = app_secret
        self.access_token = None

    def send_text_message(self, content: str) -> bool:
        """
        发送文本消息

        Args:
            content: 消息内容

        Returns:
            是否发送成功
        """
        if not self.webhook_url:
            logger.error("❌ 未配置飞书Webhook URL")
            return False

        try:
            data = {"msg_type": "text", "content": {"text": content}}

            response = requests.post(self.webhook_url, json=data, timeout=10)
            response.raise_for_status()

            result = response.json()

            if result.get("StatusCode") == 0 or result.get("code") == 0:
                logger.info("✅ 飞书消息发送成功")
                return True
            else:
                logger.error(f"❌ 飞书消息发送失败: {result}")
                return False

        except Exception as e:
            logger.error(f"❌ 发送飞书消息异常: {e}")
            return False

    def send_rich_message(self, title: str, content: str, articles: List[Dict[str, Any]] = None) -> bool:
        """
        发送富文本消息（卡片消息）

        Args:
            title: 标题
            content: 内容
            articles: 文章列表

        Returns:
            是否发送成功
        """
        if not self.webhook_url:
            logger.error("❌ 未配置飞书Webhook URL")
            return False

        try:
            # 构建卡片消息
            card = self._build_card(title, content, articles)

            data = {"msg_type": "interactive", "card": card}

            response = requests.post(self.webhook_url, json=data, timeout=10)
            response.raise_for_status()

            result = response.json()

            if result.get("StatusCode") == 0 or result.get("code") == 0:
                logger.info("✅ 飞书卡片消息发送成功")
                return True
            else:
                logger.error(f"❌ 飞书卡片消息发送失败: {result}")
                return False

        except Exception as e:
            logger.error(f"❌ 发送飞书卡片消息异常: {e}")
            return False

    def _build_card(self, title: str, content: str, articles: List[Dict[str, Any]] = None) -> Dict[str, Any]:
        """构建飞书卡片"""
        card = {
            "config": {"wide_screen_mode": True},
            "header": {"title": {"tag": "plain_text", "content": title}, "template": "blue"},
            "elements": [
                {
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": content},
                }
            ],
        }

        # 添加文章列表
        if articles:
            article_elements = []
            for i, article in enumerate(articles[:10], 1):
                importance_emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(article.get("importance", "low"), "⚪")

                article_text = f"{i}. {importance_emoji} **{article.get('title', 'Unknown')}**\n"
                article_text += f"   📰 {article.get('source', 'Unknown')} | {article.get('published_at', '')}\n"

                if article.get("summary"):
                    article_text += f"   📝 {article['summary'][:100]}...\n"

                article_elements.append({"tag": "div", "text": {"tag": "lark_md", "content": article_text}})

            card["elements"].extend(article_elements)

        return card

    def send_daily_summary(self, summary: str, articles: List[Dict[str, Any]] = None) -> bool:
        """
        发送每日摘要

        Args:
            summary: 摘要文本
            articles: 文章列表

        Returns:
            是否发送成功
        """
        title = f"📅 AI资讯每日摘要 - {datetime.now().strftime('%Y-%m-%d')}"

        # 统计信息
        stats_text = f"📊 今日共收录 **{len(articles) if articles else 0}** 篇重要资讯\n\n"

        return self.send_rich_message(title, stats_text + summary, articles)

    def send_instant_notification(self, article: Dict[str, Any]) -> bool:
        """
        发送即时通知（高重要性文章）

        Args:
            article: 文章信息

        Returns:
            是否发送成功
        """
        title = "🚨 重要AI资讯速递"
        content = f"""
**{article.get('title', 'Unknown')}**

📰 来源: {article.get('source', 'Unknown')}
🎯 重要性: {article.get('importance', 'Unknown').upper()}

📝 AI总结:
{article.get('summary', '暂无总结')[:200]}

🔗 [查看全文]({article.get('url', '')})
"""

        return self.send_rich_message(title, content)


def format_articles_for_feishu(articles: List[Any]) -> List[Dict[str, Any]]:
    """
    将文章对象转换为飞书消息格式

    Args:
        articles: 文章对象列表

    Returns:
        格式化后的文章列表
    """
    formatted = []

    for article in articles:
        formatted_article = {
            "title": article.title,
            "url": article.url,
            "source": article.source,
            "published_at": article.published_at.strftime("%Y-%m-%d %H:%M") if article.published_at else "",
            "summary": article.summary,
            "importance": article.importance,
            "topics": article.topics,
            "tags": article.tags,
        }

        formatted.append(formatted_article)

    return formatted
