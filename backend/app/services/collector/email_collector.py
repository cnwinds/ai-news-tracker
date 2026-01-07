"""
邮件数据采集器
支持IMAP和POP3协议，根据邮件标题过滤并提取文章内容
"""
import imaplib
import poplib
import email
import re
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
import logging
from email.header import decode_header
from bs4 import BeautifulSoup

from backend.app.services.collector.base_collector import BaseCollector

logger = logging.getLogger(__name__)


class EmailCollector(BaseCollector):
    """邮件采集器"""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    def fetch_articles(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        从邮箱获取文章（实现BaseCollector接口）

        Args:
            config: 采集配置字典，包含：
                - name: 源名称
                - protocol: 协议类型 ("imap" 或 "pop3")
                - server: 邮件服务器地址
                - port: 端口号
                - use_ssl: 是否使用SSL
                - username: 用户名
                - password: 密码（建议从环境变量或加密存储读取）
                - folder: IMAP文件夹（仅IMAP，默认"INBOX"）
                - title_filter: 标题过滤配置
                - content_extraction: 内容提取配置
                - max_emails: 最大邮件数（可选，默认50）

        Returns:
            文章列表
        """
        protocol = config.get("protocol", "imap").lower()
        max_emails = config.get("max_emails", 50)
        
        if protocol == "imap":
            return self._fetch_via_imap(config, max_emails)
        elif protocol == "pop3":
            return self._fetch_via_pop3(config, max_emails)
        else:
            raise ValueError(f"不支持的邮件协议: {protocol}")

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        验证邮件配置是否有效

        Args:
            config: 采集配置字典

        Returns:
            (is_valid, error_message) 元组
        """
        required_fields = ["server", "username", "password"]
        for field in required_fields:
            if not config.get(field):
                return False, f"邮件配置中缺少{field}字段"
        
        protocol = config.get("protocol", "imap").lower()
        if protocol not in ["imap", "pop3"]:
            return False, f"不支持的邮件协议: {protocol}"
        
        return True, None

    def _fetch_via_imap(self, config: Dict[str, Any], max_emails: int) -> List[Dict[str, Any]]:
        """通过IMAP协议获取邮件"""
        server = config.get("server")
        port = config.get("port", 993)
        use_ssl = config.get("use_ssl", True)
        username = config.get("username")
        password = config.get("password")
        folder = config.get("folder", "INBOX")
        title_filter = config.get("title_filter", {})
        content_extraction = config.get("content_extraction", {})

        try:
            logger.info(f"📧 正在连接IMAP服务器: {server}:{port}")

            # 连接服务器
            if use_ssl:
                mail = imaplib.IMAP4_SSL(server, port)
            else:
                mail = imaplib.IMAP4(server, port)

            # 登录
            mail.login(username, password)
            logger.info(f"✅ IMAP登录成功: {username}")

            # 选择文件夹
            mail.select(folder)
            logger.info(f"📁 已选择文件夹: {folder}")

            # 搜索未读邮件（可以根据需要修改搜索条件）
            status, messages = mail.search(None, "UNSEEN")
            if status != "OK":
                logger.warning(f"⚠️  搜索邮件失败: {status}")
                mail.logout()
                return []

            email_ids = messages[0].split()
            if not email_ids:
                logger.info("ℹ️  没有未读邮件")
                mail.logout()
                return []

            # 限制邮件数量
            email_ids = email_ids[-max_emails:] if len(email_ids) > max_emails else email_ids
            logger.info(f"📬 找到 {len(email_ids)} 封邮件，开始处理...")

            articles = []
            for email_id in reversed(email_ids):  # 从最新的开始
                try:
                    # 获取邮件
                    status, msg_data = mail.fetch(email_id, "(RFC822)")
                    if status != "OK":
                        continue

                    # 解析邮件
                    email_body = msg_data[0][1]
                    msg = email.message_from_bytes(email_body)

                    # 检查标题过滤
                    subject = self._decode_header(msg.get("Subject", ""))
                    if not self._match_title_filter(subject, title_filter):
                        continue

                    # 提取文章内容
                    article = self._extract_article_from_email(msg, config.get("name", "Email"), subject)
                    if article:
                        articles.append(article)

                except Exception as e:
                    logger.warning(f"⚠️  处理邮件失败 (ID: {email_id.decode()}): {e}")
                    continue

            mail.logout()
            logger.info(f"✅ 成功处理 {len(articles)} 封符合条件的邮件")
            return articles

        except Exception as e:
            logger.error(f"❌ IMAP采集失败: {e}")
            import traceback
            traceback.print_exc()
            return []

    def _fetch_via_pop3(self, config: Dict[str, Any], max_emails: int) -> List[Dict[str, Any]]:
        """通过POP3协议获取邮件"""
        server = config.get("server")
        port = config.get("port", 995)
        use_ssl = config.get("use_ssl", True)
        username = config.get("username")
        password = config.get("password")
        title_filter = config.get("title_filter", {})
        content_extraction = config.get("content_extraction", {})

        try:
            logger.info(f"📧 正在连接POP3服务器: {server}:{port}")

            # 连接服务器
            if use_ssl:
                mail = poplib.POP3_SSL(server, port)
            else:
                mail = poplib.POP3(server, port)

            # 登录
            mail.user(username)
            mail.pass_(password)
            logger.info(f"✅ POP3登录成功: {username}")

            # 获取邮件列表
            num_messages = len(mail.list()[1])
            if num_messages == 0:
                logger.info("ℹ️  没有邮件")
                mail.quit()
                return []

            # 限制邮件数量
            max_fetch = min(max_emails, num_messages)
            logger.info(f"📬 找到 {num_messages} 封邮件，处理最新的 {max_fetch} 封...")

            articles = []
            # POP3从1开始编号，最新的邮件编号最大
            for i in range(num_messages, num_messages - max_fetch, -1):
                try:
                    # 获取邮件
                    response, lines, octets = mail.retr(i)

                    # 解析邮件
                    email_body = b"\n".join(lines)
                    msg = email.message_from_bytes(email_body)

                    # 检查标题过滤
                    subject = self._decode_header(msg.get("Subject", ""))
                    if not self._match_title_filter(subject, title_filter):
                        continue

                    # 提取文章内容
                    article = self._extract_article_from_email(msg, config.get("name", "Email"), subject)
                    if article:
                        articles.append(article)

                except Exception as e:
                    logger.warning(f"⚠️  处理邮件失败 (序号: {i}): {e}")
                    continue

            mail.quit()
            logger.info(f"✅ 成功处理 {len(articles)} 封符合条件的邮件")
            return articles

        except Exception as e:
            logger.error(f"❌ POP3采集失败: {e}")
            import traceback
            traceback.print_exc()
            return []

    def _match_title_filter(self, subject: str, title_filter: Dict[str, Any]) -> bool:
        """
        检查邮件标题是否匹配过滤条件

        Args:
            subject: 邮件标题
            title_filter: 过滤配置，包含：
                - type: "regex"/"keywords"/"both"
                - regex: 正则表达式（可选）
                - keywords: 关键词列表（可选）

        Returns:
            是否匹配
        """
        if not title_filter:
            return True  # 没有过滤条件，全部通过

        filter_type = title_filter.get("type", "both")
        regex = title_filter.get("regex")
        keywords = title_filter.get("keywords", [])

        # 正则表达式匹配
        if filter_type in ["regex", "both"] and regex:
            try:
                if re.search(regex, subject, re.IGNORECASE):
                    return True
            except re.error as e:
                logger.warning(f"⚠️  正则表达式错误: {e}")

        # 关键词匹配
        if filter_type in ["keywords", "both"] and keywords:
            subject_lower = subject.lower()
            for keyword in keywords:
                if keyword.lower() in subject_lower:
                    return True

        # 如果设置了过滤条件但没有匹配，返回False
        if filter_type != "both" or (regex and keywords):
            return False

        return True  # 默认通过

    def _extract_article_from_email(
        self, 
        msg: email.message.Message, 
        source_name: str,
        subject: str
    ) -> Optional[Dict[str, Any]]:
        """
        从邮件中提取文章内容

        Args:
            msg: 邮件消息对象
            source_name: 源名称
            subject: 邮件标题

        Returns:
            文章字典
        """
        try:
            # 提取发送者和日期
            from_addr = self._decode_header(msg.get("From", ""))
            date_str = msg.get("Date", "")
            published_at = self._parse_email_date(date_str)

            # 提取邮件正文
            content = self._extract_email_content(msg)

            if not content:
                logger.warning(f"⚠️  邮件内容为空: {subject}")
                return None

            # 构建文章URL（使用mailto链接）
            url = f"mailto:{msg.get('From', '')}?subject={subject}"

            return {
                "title": subject,
                "url": url,
                "content": content,
                "source": source_name,
                "author": from_addr,
                "published_at": published_at,
                "category": "email",
                "metadata": {
                    "email_from": from_addr,
                    "email_date": date_str,
                },
            }

        except Exception as e:
            logger.error(f"❌ 提取邮件内容失败: {e}")
            return None

    def _extract_email_content(self, msg: email.message.Message) -> str:
        """提取邮件正文内容"""
        content = ""
        
        # 优先提取HTML内容
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type == "text/html":
                    payload = part.get_payload(decode=True)
                    if payload:
                        html_content = payload.decode("utf-8", errors="ignore")
                        # 使用BeautifulSoup提取纯文本
                        soup = BeautifulSoup(html_content, "html.parser")
                        content = soup.get_text(separator=" ", strip=True)
                        if content:
                            break
                elif content_type == "text/plain" and not content:
                    payload = part.get_payload(decode=True)
                    if payload:
                        content = payload.decode("utf-8", errors="ignore")
        else:
            # 单部分邮件
            content_type = msg.get_content_type()
            payload = msg.get_payload(decode=True)
            if payload:
                if content_type == "text/html":
                    html_content = payload.decode("utf-8", errors="ignore")
                    soup = BeautifulSoup(html_content, "html.parser")
                    content = soup.get_text(separator=" ", strip=True)
                else:
                    content = payload.decode("utf-8", errors="ignore")

        # 清理内容
        if content:
            content = " ".join(content.split())  # 移除多余空白

        return content

    def _decode_header(self, header: str) -> str:
        """解码邮件头"""
        if not header:
            return ""
        
        try:
            decoded_parts = decode_header(header)
            decoded_str = ""
            for part, encoding in decoded_parts:
                if isinstance(part, bytes):
                    if encoding:
                        decoded_str += part.decode(encoding, errors="ignore")
                    else:
                        decoded_str += part.decode("utf-8", errors="ignore")
                else:
                    decoded_str += part
            return decoded_str
        except Exception as e:
            logger.warning(f"⚠️  解码邮件头失败: {e}")
            return str(header)

    def _parse_email_date(self, date_str: str) -> Optional[datetime]:
        """解析邮件日期"""
        if not date_str:
            return None
        
        try:
            # 使用email.utils解析日期
            from email.utils import parsedate_tz, mktime_tz
            time_tuple = parsedate_tz(date_str)
            if time_tuple:
                timestamp = mktime_tz(time_tuple)
                dt = datetime.fromtimestamp(timestamp)
                # 转换为本地时间（UTC+8）
                local_tz = timezone(timedelta(hours=8))
                dt = dt.replace(tzinfo=timezone.utc).astimezone(local_tz).replace(tzinfo=None)
                return dt
        except Exception as e:
            logger.warning(f"⚠️  解析邮件日期失败: {date_str}, 错误: {e}")
        
        return None
