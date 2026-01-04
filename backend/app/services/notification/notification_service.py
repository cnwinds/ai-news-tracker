"""
通知服务 - 支持飞书和钉钉
"""
import os
import json
import hmac
import hashlib
import base64
import time
import requests
from typing import Optional, List, Dict, Any
from datetime import datetime
from sqlalchemy.orm import Session

from backend.app.db.models import NotificationLog, Article
from backend.app.utils.logger import setup_logger

logger = setup_logger(__name__)


class NotificationService:
    """通知服务 - 支持飞书和钉钉两种通知方式"""

    def __init__(
        self,
        platform: str = "feishu",  # feishu 或 dingtalk
        webhook_url: str = "",
        secret: str = "",  # 钉钉加签密钥（可选）
    ):
        """
        初始化通知服务
        
        Args:
            platform: 通知平台，支持 "feishu" 或 "dingtalk"
            webhook_url: Webhook URL
            secret: 钉钉加签密钥（仅钉钉需要，可选）
        """
        self.platform = platform.lower()
        self.webhook_url = webhook_url
        self.secret = secret
        
        if not self.webhook_url:
            logger.warning(f"⚠️  {self.platform} Webhook URL 未配置")
        
        if self.platform == "dingtalk" and self.secret:
            logger.info(f"✅ 钉钉通知服务已初始化（使用加签）")
        elif self.platform == "dingtalk":
            logger.info(f"✅ 钉钉通知服务已初始化（未使用加签）")
        elif self.platform == "feishu":
            logger.info(f"✅ 飞书通知服务已初始化")
        else:
            logger.warning(f"⚠️  不支持的通知平台: {self.platform}")

    def _sign_dingtalk(self, timestamp: str) -> str:
        """
        生成钉钉加签
        
        Args:
            timestamp: 时间戳（字符串）
            
        Returns:
            签名字符串
        """
        if not self.secret:
            return ""
        
        string_to_sign = f"{timestamp}\n{self.secret}"
        hmac_code = hmac.new(
            self.secret.encode('utf-8'),
            string_to_sign.encode('utf-8'),
            digestmod=hashlib.sha256
        ).digest()
        sign = base64.b64encode(hmac_code).decode('utf-8')
        return sign

    def _send_to_feishu(self, content: Dict[str, Any]) -> bool:
        """
        发送消息到飞书
        
        Args:
            content: 消息内容（字典格式）
            
        Returns:
            是否发送成功
        """
        try:
            response = requests.post(
                self.webhook_url,
                json=content,
                timeout=10
            )
            response.raise_for_status()
            result = response.json()
            
            if result.get("code") == 0:
                logger.info("✅ 飞书消息发送成功")
                return True
            else:
                error_msg = result.get("msg", "未知错误")
                logger.error(f"❌ 飞书消息发送失败: {error_msg}")
                return False
                
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ 飞书消息发送异常: {e}")
            return False

    def _send_to_dingtalk(self, content: Dict[str, Any]) -> bool:
        """
        发送消息到钉钉
        
        Args:
            content: 消息内容（字典格式）
            
        Returns:
            是否发送成功
        """
        try:
            # 如果使用了加签，需要添加签名参数
            if self.secret:
                timestamp = str(round(time.time() * 1000))
                sign = self._sign_dingtalk(timestamp)
                url = f"{self.webhook_url}&timestamp={timestamp}&sign={sign}"
            else:
                url = self.webhook_url
            
            response = requests.post(
                url,
                json=content,
                timeout=10
            )
            response.raise_for_status()
            result = response.json()
            
            if result.get("errcode") == 0:
                logger.info("✅ 钉钉消息发送成功")
                return True
            else:
                error_msg = result.get("errmsg", "未知错误")
                logger.error(f"❌ 钉钉消息发送失败: {error_msg}")
                return False
                
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ 钉钉消息发送异常: {e}")
            return False

    def _send_message(self, content: Dict[str, Any]) -> bool:
        """
        发送消息（根据平台选择对应的方法）
        
        Args:
            content: 消息内容
            
        Returns:
            是否发送成功
        """
        if not self.webhook_url:
            logger.warning(f"⚠️  {self.platform} Webhook URL 未配置，无法发送消息")
            return False
        
        if self.platform == "feishu":
            return self._send_to_feishu(content)
        elif self.platform == "dingtalk":
            return self._send_to_dingtalk(content)
        else:
            logger.error(f"❌ 不支持的通知平台: {self.platform}")
            return False

    def _log_notification(
        self,
        db: Session,
        notification_type: str,
        status: str,
        articles_count: int = 0,
        error_message: Optional[str] = None
    ):
        """
        记录通知日志
        
        Args:
            db: 数据库会话
            notification_type: 通知类型（daily_summary/weekly_summary/instant）
            status: 状态（success/error）
            articles_count: 文章数量
            error_message: 错误信息（如果有）
        """
        try:
            log = NotificationLog(
                notification_type=notification_type,
                platform=self.platform,
                status=status,
                articles_count=articles_count,
                error_message=error_message,
                sent_at=datetime.now()
            )
            db.add(log)
            db.commit()
        except Exception as e:
            logger.error(f"❌ 记录通知日志失败: {e}")
            db.rollback()

    def send_daily_summary(
        self,
        summary_content: str,
        db: Session,
        limit: int = 20
    ) -> bool:
        """
        发送每日/每周摘要
        
        Args:
            summary_content: 摘要内容
            db: 数据库会话
            limit: 推荐文章数量限制
            
        Returns:
            是否发送成功
        """
        try:
            # 获取推荐文章
            articles = (
                db.query(Article)
                .filter(Article.importance.in_(["high", "medium"]))
                .order_by(Article.published_at.desc())
                .limit(limit)
                .all()
            )
            
            # 构建消息内容
            if self.platform == "feishu":
                content = self._build_feishu_summary_message(summary_content, articles)
            else:  # dingtalk
                content = self._build_dingtalk_summary_message(summary_content, articles)
            
            # 发送消息
            success = self._send_message(content)
            
            # 记录日志
            self._log_notification(
                db=db,
                notification_type="daily_summary",
                status="success" if success else "error",
                articles_count=len(articles),
                error_message=None if success else "发送失败"
            )
            
            return success
            
        except Exception as e:
            logger.error(f"❌ 发送摘要失败: {e}", exc_info=True)
            self._log_notification(
                db=db,
                notification_type="daily_summary",
                status="error",
                articles_count=0,
                error_message=str(e)
            )
            return False

    def send_instant_alert(self, article: Article, db: Optional[Session] = None) -> bool:
        """
        发送即时提醒（高重要性文章）
        
        Args:
            article: 文章对象
            db: 数据库会话（可选）
            
        Returns:
            是否发送成功
        """
        try:
            # 构建消息内容
            if self.platform == "feishu":
                content = self._build_feishu_instant_message(article)
            else:  # dingtalk
                content = self._build_dingtalk_instant_message(article)
            
            # 发送消息
            success = self._send_message(content)
            
            # 记录日志（如果提供了数据库会话）
            if db:
                self._log_notification(
                    db=db,
                    notification_type="instant",
                    status="success" if success else "error",
                    articles_count=1,
                    error_message=None if success else "发送失败"
                )
            
            return success
            
        except Exception as e:
            logger.error(f"❌ 发送即时提醒失败: {e}", exc_info=True)
            if db:
                self._log_notification(
                    db=db,
                    notification_type="instant",
                    status="error",
                    articles_count=1,
                    error_message=str(e)
                )
            return False

    def _build_feishu_summary_message(
        self,
        summary_content: str,
        articles: List[Article]
    ) -> Dict[str, Any]:
        """构建飞书摘要消息"""
        # 构建推荐文章列表
        article_elements = []
        for article in articles[:10]:  # 最多显示10篇
            title = article.title_zh or article.title
            article_elements.append({
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": f"• [{title}]({article.url})"
                }
            })
        
        content = {
            "msg_type": "interactive",
            "card": {
                "config": {
                    "wide_screen_mode": True
                },
                "header": {
                    "title": {
                        "tag": "plain_text",
                        "content": "📰 AI新闻每日摘要"
                    },
                    "template": "blue"
                },
                "elements": [
                    {
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": f"**摘要内容**\n\n{summary_content}"
                        }
                    },
                    {
                        "tag": "hr"
                    },
                    {
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": f"**推荐文章** ({len(articles)} 篇)"
                        }
                    },
                    *article_elements
                ]
            }
        }
        
        return content

    def _build_dingtalk_summary_message(
        self,
        summary_content: str,
        articles: List[Article]
    ) -> Dict[str, Any]:
        """构建钉钉摘要消息"""
        # 构建推荐文章列表
        article_list = []
        for article in articles[:10]:  # 最多显示10篇
            title = article.title_zh or article.title
            article_list.append(f"• [{title}]({article.url})")
        
        articles_text = "\n".join(article_list) if article_list else "暂无推荐文章"
        
        content = {
            "msgtype": "markdown",
            "markdown": {
                "title": "📰 AI新闻每日摘要",
                "text": f"""## 📰 AI新闻每日摘要

**摘要内容**

{summary_content}

---

**推荐文章** ({len(articles)} 篇)

{articles_text}
"""
            }
        }
        
        return content

    def _build_feishu_instant_message(self, article: Article) -> Dict[str, Any]:
        """构建飞书即时提醒消息"""
        title = article.title_zh or article.title
        summary = article.summary or "暂无摘要"
        
        content = {
            "msg_type": "interactive",
            "card": {
                "config": {
                    "wide_screen_mode": True
                },
                "header": {
                    "title": {
                        "tag": "plain_text",
                        "content": "🚨 高重要性文章提醒"
                    },
                    "template": "red"
                },
                "elements": [
                    {
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": f"**标题**: {title}\n\n**摘要**: {summary[:200]}..."
                        }
                    },
                    {
                        "tag": "action",
                        "actions": [
                            {
                                "tag": "button",
                                "text": {
                                    "tag": "plain_text",
                                    "content": "查看原文"
                                },
                                "type": "default",
                                "url": article.url
                            }
                        ]
                    }
                ]
            }
        }
        
        return content

    def _build_dingtalk_instant_message(self, article: Article) -> Dict[str, Any]:
        """构建钉钉即时提醒消息"""
        title = article.title_zh or article.title
        summary = article.summary or "暂无摘要"
        
        content = {
            "msgtype": "markdown",
            "markdown": {
                "title": "🚨 高重要性文章提醒",
                "text": f"""## 🚨 高重要性文章提醒

**标题**: {title}

**摘要**: {summary[:200]}...

[查看原文]({article.url})
"""
            }
        }
        
        return content
