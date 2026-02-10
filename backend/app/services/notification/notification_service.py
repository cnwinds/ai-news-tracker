"""
通知服务 - 支持飞书和钉钉
"""
import hmac
import hashlib
import base64
import time
import requests
from typing import Optional, Dict, Any, Union
from datetime import datetime
from sqlalchemy.orm import Session

from backend.app.db.models import NotificationLog, Article
from backend.app.db import DatabaseManager
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

    def _is_in_quiet_hours(self) -> bool:
        """
        检查当前时间是否在勿扰时段内
        
        Returns:
            如果在勿扰时段内返回True，否则返回False
        """
        from backend.app.core.settings import settings
        
        # 确保加载最新配置
        settings.load_settings_from_db()
        
        quiet_hours = settings.QUIET_HOURS
        if not quiet_hours:
            return False
        
        now = datetime.now()
        current_time = now.time()
        current_hour = current_time.hour
        current_minute = current_time.minute
        current_minutes = current_hour * 60 + current_minute
        
        for qh in quiet_hours:
            try:
                start_time_str = qh.get("start_time", "")
                end_time_str = qh.get("end_time", "")
                
                if not start_time_str or not end_time_str:
                    continue
                
                # 解析时间字符串 (HH:MM格式)
                start_parts = start_time_str.split(":")
                end_parts = end_time_str.split(":")
                
                if len(start_parts) != 2 or len(end_parts) != 2:
                    continue
                
                start_hour = int(start_parts[0])
                start_minute = int(start_parts[1])
                end_hour = int(end_parts[0])
                end_minute = int(end_parts[1])
                
                start_minutes = start_hour * 60 + start_minute
                end_minutes = end_hour * 60 + end_minute
                
                # 处理跨天的情况（例如22:00-08:00）
                if start_minutes > end_minutes:
                    # 跨天时段：从start到24:00，或从00:00到end（包含end时间点）
                    if current_minutes >= start_minutes or current_minutes <= end_minutes:
                        logger.info(f"⏰ 当前时间 {current_time.strftime('%H:%M')} 在勿扰时段 {start_time_str}-{end_time_str} 内")
                        return True
                else:
                    # 同一天时段（包含end时间点）
                    if start_minutes <= current_minutes <= end_minutes:
                        logger.info(f"⏰ 当前时间 {current_time.strftime('%H:%M')} 在勿扰时段 {start_time_str}-{end_time_str} 内")
                        return True
            except (ValueError, KeyError, IndexError) as e:
                logger.warning(f"⚠️  解析勿扰时段失败: {qh}, 错误: {e}")
                continue
        
        return False

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
        db: Union[Session, DatabaseManager],
        notification_type: str,
        status: str,
        articles_count: int = 0,
        error_message: Optional[str] = None
    ):
        """
        记录通知日志
        
        Args:
            db: 数据库会话或数据库管理器
            notification_type: 通知类型（daily_summary/weekly_summary/instant）
            status: 状态（success/error）
            articles_count: 文章数量
            error_message: 错误信息（如果有）
        """
        # 如果是 DatabaseManager，使用上下文管理器获取会话
        if isinstance(db, DatabaseManager):
            try:
                with db.get_session() as session:
                    log = NotificationLog(
                        notification_type=notification_type,
                        platform=self.platform,
                        status=status,
                        articles_count=articles_count,
                        error_message=error_message,
                        sent_at=datetime.now()
                    )
                    session.add(log)
                    session.commit()
            except Exception as e:
                logger.error(f"❌ 记录通知日志失败: {e}")
        else:
            # 如果是 Session，直接使用
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

    def send_weekly_summary(
        self,
        summary_content: str,
        db: Union[Session, DatabaseManager],
        articles_count: Optional[int] = None
    ) -> bool:
        """
        发送每周摘要

        Args:
            summary_content: 摘要内容
            db: 数据库会话或数据库管理器
            articles_count: 文章数量（用于日志）

        Returns:
            是否发送成功
        """
        # 检查是否在勿扰时段内
        if self._is_in_quiet_hours():
            logger.info("⏰ 当前处于勿扰时段，跳过每周摘要通知")
            return False
        
        try:
            # 构建消息内容（与Web保持一致）
            if self.platform == "feishu":
                content = self._build_feishu_summary_message(summary_content)
            else:  # dingtalk
                content = self._build_dingtalk_summary_message(summary_content)

            # 发送消息
            success = self._send_message(content)

            # 记录日志
            self._log_notification(
                db=db,
                notification_type="weekly_summary",
                status="success" if success else "error",
                articles_count=articles_count or 0,
                error_message=None if success else "发送失败"
            )

            return success
        except Exception as e:
            logger.error(f"❌ 发送每周摘要失败: {e}", exc_info=True)
            self._log_notification(
                db=db,
                notification_type="weekly_summary",
                status="error",
                articles_count=articles_count or 0,
                error_message=str(e)
            )
            return False

    def send_daily_summary(
        self,
        summary_content: str,
        db: Union[Session, DatabaseManager],
        articles_count: Optional[int] = None
    ) -> bool:
        """
        发送每日摘要

        Args:
            summary_content: 摘要内容
            db: 数据库会话或数据库管理器
            articles_count: 文章数量（用于日志）

        Returns:
            是否发送成功
        """
        # 检查是否在勿扰时段内
        if self._is_in_quiet_hours():
            logger.info("⏰ 当前处于勿扰时段，跳过每日摘要通知")
            return False
        
        try:
            # 构建消息内容（与Web保持一致）
            if self.platform == "feishu":
                content = self._build_feishu_summary_message(summary_content)
            else:  # dingtalk
                content = self._build_dingtalk_summary_message(summary_content)

            # 发送消息
            success = self._send_message(content)

            # 记录日志
            self._log_notification(
                db=db,
                notification_type="daily_summary",
                status="success" if success else "error",
                articles_count=articles_count or 0,
                error_message=None if success else "发送失败"
            )

            return success

        except Exception as e:
            logger.error(f"❌ 发送摘要失败: {e}", exc_info=True)
            self._log_notification(
                db=db,
                notification_type="daily_summary",
                status="error",
                articles_count=articles_count or 0,
                error_message=str(e)
            )
            return False

    def send_instant_alert(self, article: Article, db: Optional[Union[Session, DatabaseManager]] = None) -> bool:
        """
        发送即时提醒（高重要性文章）
        
        Args:
            article: 文章对象
            db: 数据库会话（可选）
            
        Returns:
            是否发送成功
        """
        # 检查是否在勿扰时段内
        if self._is_in_quiet_hours():
            logger.info("⏰ 当前处于勿扰时段，跳过即时通知")
            return False
        
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

    def send_exploration_report_alert(
        self,
        report_data: Dict[str, Any],
        db: Optional[Union[Session, DatabaseManager]] = None,
    ) -> bool:
        """
        发送模型先知报告通知

        Args:
            report_data: 报告信息
            db: 数据库会话（可选）

        Returns:
            是否发送成功
        """
        try:
            if self.platform == "feishu":
                content = self._build_feishu_exploration_report_message(report_data)
            else:  # dingtalk
                content = self._build_dingtalk_exploration_report_message(report_data)

            success = self._send_message(content)

            if db:
                self._log_notification(
                    db=db,
                    notification_type="exploration_report",
                    status="success" if success else "error",
                    articles_count=1,
                    error_message=None if success else "发送失败",
                )
            return success
        except Exception as e:
            logger.error(f"❌ 发送模型先知报告通知失败: {e}", exc_info=True)
            if db:
                self._log_notification(
                    db=db,
                    notification_type="exploration_report",
                    status="error",
                    articles_count=1,
                    error_message=str(e),
                )
            return False

    def _build_feishu_summary_message(
        self,
        summary_content: str
    ) -> Dict[str, Any]:
        """构建飞书摘要消息（与Web一致）"""
        content = {
            "msg_type": "interactive",
            "card": {
                "config": {
                    "wide_screen_mode": True
                },
                "elements": [
                    {
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": summary_content or "暂无摘要"
                        }
                    }
                ]
            }
        }

        return content

    def _build_dingtalk_summary_message(
        self,
        summary_content: str
    ) -> Dict[str, Any]:
        """构建钉钉摘要消息（与Web一致）"""
        content = {
            "msgtype": "markdown",
            "markdown": {
                "title": "📰 AI新闻摘要",
                "text": summary_content or "暂无摘要"
            }
        }
        
        return content

    def _build_feishu_instant_message(self, article: Article) -> Dict[str, Any]:
        """构建飞书即时提醒消息"""
        title = article.title_zh or article.title
        # 优先使用摘要（3句话），如果没有则使用精读，最后使用"暂无摘要"
        summary = article.summary or article.detailed_summary or "暂无摘要"
        
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
        # 优先使用摘要（3句话），如果没有则使用精读，最后使用"暂无摘要"
        summary = article.summary or article.detailed_summary or "暂无摘要"
        
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

    def _build_feishu_exploration_report_message(self, report_data: Dict[str, Any]) -> Dict[str, Any]:
        """构建飞书模型先知报告通知消息"""
        model_name = str(report_data.get("model_name") or "未知模型")
        source_platform = str(report_data.get("source_platform") or "unknown")
        final_score = report_data.get("final_score")
        release_confidence = report_data.get("release_confidence")
        report_id = str(report_data.get("report_id") or "")
        summary = str(report_data.get("summary") or "报告已生成，可进入系统查看详情。").strip()
        export_url = str(report_data.get("export_url") or "").strip()

        try:
            final_score_text = f"{float(final_score):.1f}/100"
        except (TypeError, ValueError):
            final_score_text = "N/A"
        try:
            confidence_text = f"{float(release_confidence):.1f}/100"
        except (TypeError, ValueError):
            confidence_text = "N/A"

        lines = [
            "## 🔭 模型先知新报告",
            f"- 模型：**{model_name}**",
            f"- 来源：{source_platform}",
            f"- 综合评分：{final_score_text}",
            f"- 发布置信度：{confidence_text}",
        ]
        if report_id:
            lines.append(f"- 报告ID：`{report_id}`")
        lines.extend(["", summary[:400]])
        if export_url:
            lines.extend(["", f"[导出报告]({export_url})"])

        return {
            "msg_type": "interactive",
            "card": {
                "config": {"wide_screen_mode": True},
                "elements": [
                    {
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": "\n".join(lines),
                        },
                    }
                ],
            },
        }

    def _build_dingtalk_exploration_report_message(self, report_data: Dict[str, Any]) -> Dict[str, Any]:
        """构建钉钉模型先知报告通知消息"""
        model_name = str(report_data.get("model_name") or "未知模型")
        source_platform = str(report_data.get("source_platform") or "unknown")
        final_score = report_data.get("final_score")
        release_confidence = report_data.get("release_confidence")
        report_id = str(report_data.get("report_id") or "")
        summary = str(report_data.get("summary") or "报告已生成，可进入系统查看详情。").strip()
        export_url = str(report_data.get("export_url") or "").strip()

        try:
            final_score_text = f"{float(final_score):.1f}/100"
        except (TypeError, ValueError):
            final_score_text = "N/A"
        try:
            confidence_text = f"{float(release_confidence):.1f}/100"
        except (TypeError, ValueError):
            confidence_text = "N/A"

        text_lines = [
            "## 🔭 模型先知新报告",
            "",
            f"- 模型：**{model_name}**",
            f"- 来源：{source_platform}",
            f"- 综合评分：{final_score_text}",
            f"- 发布置信度：{confidence_text}",
        ]
        if report_id:
            text_lines.append(f"- 报告ID：`{report_id}`")
        text_lines.extend(["", summary[:400]])
        if export_url:
            text_lines.extend(["", f"[导出报告]({export_url})"])

        return {
            "msgtype": "markdown",
            "markdown": {
                "title": "模型先知新报告",
                "text": "\n".join(text_lines),
            },
        }
