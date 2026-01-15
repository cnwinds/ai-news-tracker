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


def encode_imap_folder(folder_name: str) -> bytes:
    """
    将文件夹名称编码为 IMAP 格式（支持中文）
    
    IMAP 使用 modified UTF-7 编码，但 Python 的 imaplib 在 Python 3 中
    可以处理 UTF-8 编码的字节字符串。
    
    Args:
        folder_name: 文件夹名称（可以是中文）
    
    Returns:
        编码后的字节字符串
    """
    if not folder_name:
        return b"INBOX"
    
    # 如果只包含 ASCII 字符，直接返回
    try:
        folder_name.encode('ascii')
        return folder_name.encode('utf-8')
    except UnicodeEncodeError:
        # 包含非 ASCII 字符，使用 UTF-8 编码
        # IMAP 服务器应该能够处理 UTF-8 编码的文件夹名称
        return folder_name.encode('utf-8')


class EmailCollector(BaseCollector):
    """邮件采集器"""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    def list_folders(self, config: Dict[str, Any]) -> List[str]:
        """
        获取IMAP邮箱的文件夹列表
        
        Args:
            config: 邮件配置字典，包含服务器、用户名、密码等信息
        
        Returns:
            文件夹名称列表
        """
        server = config.get("server")
        port = config.get("port", 993)
        use_ssl = config.get("use_ssl", True)
        username = config.get("username")
        password = config.get("password")
        
        folders = []
        mail = None
        
        try:
            logger.info(f"📧 正在连接IMAP服务器获取文件夹列表: {server}:{port}")
            
            # 连接服务器
            if use_ssl:
                mail = imaplib.IMAP4_SSL(server, port)
            else:
                mail = imaplib.IMAP4(server, port)
            
            # 设置编码为 UTF-8 以支持中文文件夹名称
            mail._encoding = 'utf-8'
            
            # 登录
            mail.login(username, password)
            logger.info(f"✅ IMAP登录成功: {username}")
            
            # 获取文件夹列表
            # LIST 命令格式: LIST "" "*"
            # "" 表示从根目录开始， "*" 表示匹配所有文件夹
            status, folders_data = mail.list()
            
            if status != "OK":
                logger.error(f"❌ 获取文件夹列表失败: 状态 {status}")
                if mail:
                    mail.logout()
                return []
            
            # 解析文件夹列表
            # folders_data 格式: [(b'(\HasChildren) "/" "INBOX"', b'INBOX'), ...]
            for folder_info in folders_data:
                if isinstance(folder_info, bytes):
                    # 解析文件夹信息
                    # 格式通常是: (\\HasChildren) "/" "文件夹名称"
                    try:
                        # 尝试提取文件夹名称
                        folder_str = folder_info.decode('utf-8', errors='ignore')
                        # 查找最后一个引号对中的内容
                        parts = folder_str.split('"')
                        if len(parts) >= 2:
                            folder_name = parts[-2]  # 最后一个引号对中的内容
                            if folder_name:
                                folders.append(folder_name)
                    except Exception as e:
                        logger.debug(f"解析文件夹信息失败: {folder_info}, 错误: {e}")
                        continue
                elif isinstance(folder_info, tuple) and len(folder_info) >= 2:
                    # 如果返回的是元组，第二个元素可能是文件夹名称
                    try:
                        folder_name = folder_info[1].decode('utf-8', errors='ignore')
                        if folder_name:
                            folders.append(folder_name)
                    except Exception as e:
                        logger.debug(f"解析文件夹元组失败: {folder_info}, 错误: {e}")
                        continue
            
            # 去重并排序
            folders = sorted(list(set(folders)))
            
            logger.info(f"✅ 成功获取 {len(folders)} 个文件夹: {', '.join(folders[:10])}{'...' if len(folders) > 10 else ''}")
            
            if mail:
                mail.logout()
            
            return folders
            
        except Exception as e:
            logger.error(f"❌ 获取文件夹列表失败: {e}")
            import traceback
            traceback.print_exc()
            if mail:
                try:
                    mail.logout()
                except:
                    pass
            return []

    def fetch_articles(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        从邮箱获取文章（实现BaseCollector接口）

        Args:
            config: 采集配置字典，包含：
                - name: 源名称
                - protocol: 协议类型 ("imap" 或 "pop3"，默认 "pop3")
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
        protocol = config.get("protocol", "pop3").lower()
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
        
        protocol = config.get("protocol", "pop3").lower()
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
            
            # 设置编码为 UTF-8 以支持中文文件夹名称
            mail._encoding = 'utf-8'

            # 登录
            try:
                mail.login(username, password)
                logger.info(f"✅ IMAP登录成功: {username}")
            except imaplib.IMAP4.error as e:
                error_msg = str(e)
                logger.error(f"❌ IMAP登录失败: {error_msg}")
                
                # 针对163邮箱的常见登录错误提供提示
                if "Unsafe Login" in error_msg or "unsafe" in error_msg.lower() or "163" in server.lower():
                    logger.error("💡 163邮箱登录提示:")
                    logger.error("   1. 请确保使用的是授权码（授权密码），而不是登录密码")
                    logger.error("   2. 授权码获取方式：登录163邮箱 -> 设置 -> POP3/SMTP/IMAP -> 开启IMAP服务 -> 生成授权码")
                    logger.error("   3. 如果已使用授权码仍报错，请检查授权码是否过期或已撤销")
                    logger.error("   4. 如问题仍存在，可能需要联系163客服: kefu@188.com")
                elif "authentication failed" in error_msg.lower() or "invalid" in error_msg.lower():
                    logger.error("💡 认证失败提示:")
                    logger.error("   1. 请检查用户名和密码（授权码）是否正确")
                    logger.error("   2. 对于163邮箱，必须使用授权码而非登录密码")
                
                raise

            # 获取并显示文件夹列表（用于调试和帮助用户了解可用文件夹）
            try:
                status, folders_data = mail.list()
                if status == "OK":
                    folder_names = []
                    for folder_info in folders_data:
                        try:
                            if isinstance(folder_info, bytes):
                                folder_str = folder_info.decode('utf-8', errors='ignore')
                            elif isinstance(folder_info, str):
                                folder_str = folder_info
                            else:
                                continue
                            
                            # IMAP LIST 响应格式示例:
                            # (\\HasChildren) "/" "INBOX"
                            # (\\HasNoChildren) "/" "Sent"
                            # 需要提取最后一个引号对中的内容
                            
                            # 查找所有引号对
                            # 匹配引号中的内容（支持转义引号）
                            matches = re.findall(r'"((?:[^"\\]|\\.)*)"', folder_str)
                            if matches:
                                # 取最后一个匹配（通常是文件夹名称）
                                folder_name = matches[-1]
                                # 处理转义字符
                                folder_name = folder_name.replace('\\"', '"').replace('\\\\', '\\')
                                if folder_name and folder_name not in folder_names:
                                    folder_names.append(folder_name)
                        except Exception as e:
                            logger.debug(f"解析文件夹信息失败: {folder_info}, 错误: {e}")
                            continue
                    
                    # 排序
                    folder_names = sorted(folder_names)
                    if folder_names:
                        logger.info(f"📂 可用文件夹列表 ({len(folder_names)} 个):")
                        # 每行显示几个文件夹，避免日志过长
                        for i in range(0, len(folder_names), 5):
                            batch = folder_names[i:i+5]
                            logger.info(f"   {', '.join(batch)}")
                    else:
                        logger.warning("⚠️  未获取到文件夹列表")
                else:
                    logger.warning(f"⚠️  获取文件夹列表失败: 状态 {status}, 响应: {folders_data}")
            except Exception as e:
                logger.warning(f"⚠️  获取文件夹列表时出错（不影响后续操作）: {e}")
                import traceback
                logger.debug(f"详细错误: {traceback.format_exc()}")

            # 选择文件夹（支持中文文件夹名称）
            # 由于已设置 mail._encoding = 'utf-8'，可以直接使用 Unicode 字符串
            status, data = mail.select(folder)
            if status != "OK":
                error_msg = data[0].decode('utf-8', errors='ignore') if data and len(data) > 0 else str(data)
                logger.error(f"❌ 选择文件夹失败: {folder}, 状态: {status}, 响应: {error_msg}")
                
                # 针对163邮箱的"Unsafe Login"错误提供详细提示
                if "Unsafe Login" in error_msg or "unsafe" in error_msg.lower():
                    logger.error("💡 163邮箱安全提示:")
                    logger.error("   1. 请确保使用的是授权码（授权密码），而不是登录密码")
                    logger.error("   2. 授权码获取方式：登录163邮箱 -> 设置 -> POP3/SMTP/IMAP -> 开启IMAP服务 -> 生成授权码")
                    logger.error("   3. 如果已使用授权码仍报错，请检查授权码是否过期或已撤销")
                    logger.error("   4. 如问题仍存在，可能需要联系163客服: kefu@188.com")
                
                mail.logout()
                return []
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
                    # 获取邮件的接收时间（INTERNALDATE）
                    received_at = None
                    try:
                        status, date_data = mail.fetch(email_id, "(INTERNALDATE)")
                        if status == "OK" and date_data and len(date_data) > 0:
                            # INTERNALDATE格式可能是:
                            # b'1 (INTERNALDATE "05-Jan-2025 10:30:00 +0800")'
                            # 或 b'(INTERNALDATE "05-Jan-2025 10:30:00 +0800")'
                            date_str = date_data[0].decode('utf-8', errors='ignore')
                            logger.debug(f"📅 邮件INTERNALDATE原始数据: {date_str}")
                            
                            # 提取日期字符串
                            date_match = re.search(r'INTERNALDATE\s+"([^"]+)"', date_str)
                            if date_match:
                                internal_date_str = date_match.group(1)
                                logger.debug(f"📅 提取的INTERNALDATE字符串: {internal_date_str}")
                                
                                # INTERNALDATE格式通常是: "DD-MMM-YYYY HH:MM:SS +HHMM"
                                # 使用email.utils直接解析（它支持INTERNALDATE格式）
                                try:
                                    from email.utils import parsedate_tz, mktime_tz
                                    time_tuple = parsedate_tz(internal_date_str)
                                    if time_tuple:
                                        timestamp = mktime_tz(time_tuple)
                                        # 从时间戳创建UTC时间
                                        dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
                                        # 转换为本地时间（UTC+8）
                                        local_tz = timezone(timedelta(hours=8))
                                        received_at = dt.astimezone(local_tz).replace(tzinfo=None)
                                        logger.info(f"✅ 成功解析邮件接收时间: {received_at}")
                                    else:
                                        logger.warning(f"⚠️  无法解析INTERNALDATE时间元组: {internal_date_str}")
                                except Exception as e2:
                                    logger.warning(f"⚠️  解析INTERNALDATE失败: {internal_date_str}, 错误: {e2}")
                            else:
                                logger.warning(f"⚠️  无法从INTERNALDATE响应中提取日期字符串: {date_str}")
                    except Exception as e:
                        logger.warning(f"⚠️  获取邮件接收时间失败: {e}")
                    
                    # 如果无法获取接收时间，使用当前时间（但记录警告）
                    if not received_at:
                        logger.warning(f"⚠️  无法获取邮件接收时间，使用当前时间作为备选")
                        received_at = datetime.now()
                    
                    # 获取邮件
                    status, msg_data = mail.fetch(email_id, "(RFC822)")
                    if status != "OK":
                        continue

                    # 解析邮件
                    email_body = msg_data[0][1]
                    msg = email.message_from_bytes(email_body)

                    # 检查过滤条件（标题或发件人）
                    subject = self._decode_header(msg.get("Subject", ""))
                    from_addr = self._decode_header(msg.get("From", ""))
                    if not self._match_email_filter(subject, from_addr, title_filter):
                        continue

                    # 提取文章内容（传入接收时间）
                    article = self._extract_article_from_email(msg, config.get("name", "Email"), subject, received_at=received_at)
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

                    # 尝试从邮件头中提取接收时间（Received字段）
                    received_at = self._extract_received_time_from_headers(msg)
                    
                    # 如果无法从Received字段获取，使用当前时间作为备选
                    if not received_at:
                        logger.debug(f"⚠️  无法从邮件头提取接收时间，使用当前时间作为备选")
                        received_at = datetime.now()

                    # 检查过滤条件（标题或发件人）
                    subject = self._decode_header(msg.get("Subject", ""))
                    from_addr = self._decode_header(msg.get("From", ""))
                    if not self._match_email_filter(subject, from_addr, title_filter):
                        continue

                    # 提取文章内容（使用提取的接收时间）
                    article = self._extract_article_from_email(msg, config.get("name", "Email"), subject, received_at=received_at)
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

    def _match_email_filter(self, subject: str, from_addr: str, title_filter: Dict[str, Any]) -> bool:
        """
        检查邮件是否匹配过滤条件（支持标题和发件人过滤）

        Args:
            subject: 邮件标题
            from_addr: 发件人地址
            title_filter: 过滤配置，包含：
                - type: "regex"/"keywords"/"both"/"sender"（sender表示过滤发件人）
                - regex: 正则表达式（可选，用于标题）
                - keywords: 关键词列表（可选，用于标题或发件人）
                - filter_sender: 是否过滤发件人（可选，默认false）

        Returns:
            是否匹配
        """
        if not title_filter:
            return True  # 没有过滤条件，全部通过

        filter_type = title_filter.get("type", "both")
        regex = title_filter.get("regex")
        keywords = title_filter.get("keywords", [])
        filter_sender = title_filter.get("filter_sender", False)  # 是否过滤发件人

        # 如果配置了filter_sender或type为"sender"，则检查发件人
        if filter_sender or filter_type == "sender":
            if keywords:
                from_addr_lower = from_addr.lower()
                for keyword in keywords:
                    if keyword.lower() in from_addr_lower:
                        return True
                # 如果设置了发件人过滤但没有匹配，返回False
                return False

        # 标题过滤（正则表达式匹配）
        if filter_type in ["regex", "both"] and regex:
            try:
                if re.search(regex, subject, re.IGNORECASE):
                    return True
            except re.error as e:
                logger.warning(f"⚠️  正则表达式错误: {e}")

        # 标题过滤（关键词匹配）
        if filter_type in ["keywords", "both"] and keywords and not filter_sender:
            subject_lower = subject.lower()
            for keyword in keywords:
                if keyword.lower() in subject_lower:
                    return True

        # 如果设置了过滤条件但没有匹配，返回False
        if filter_type not in ["both", "sender"] and not filter_sender:
            if (filter_type == "regex" and regex) or (filter_type == "keywords" and keywords):
                return False

        return True  # 默认通过

    def _extract_article_from_email(
        self, 
        msg: email.message.Message, 
        source_name: str,
        subject: str,
        received_at: Optional[datetime] = None
    ) -> Optional[Dict[str, Any]]:
        """
        从邮件中提取文章内容

        Args:
            msg: 邮件消息对象
            source_name: 源名称
            subject: 邮件标题
            received_at: 邮件接收时间（如果为None，则使用邮件的Date字段）

        Returns:
            文章字典
        """
        try:
            # 提取发送者和日期
            from_addr = self._decode_header(msg.get("From", ""))
            date_str = msg.get("Date", "")
            
            # 优先使用接收时间，如果没有则使用发送时间
            if received_at:
                published_at = received_at
            else:
                published_at = self._parse_email_date(date_str)
                # 如果解析失败，使用当前时间
                if not published_at:
                    published_at = datetime.now()

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
                    "email_received_at": received_at.isoformat() if received_at else None,
                },
            }

        except Exception as e:
            logger.error(f"❌ 提取邮件内容失败: {e}")
            return None

    def _extract_email_content(self, msg: email.message.Message) -> str:
        """提取邮件正文内容，保留超链接信息"""
        content = ""
        is_html = False
        
        # 优先提取HTML内容
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type == "text/html":
                    payload = part.get_payload(decode=True)
                    if payload:
                        html_content = payload.decode("utf-8", errors="ignore")
                        # 使用BeautifulSoup提取内容并保留链接
                        content = self._extract_html_with_links(html_content)
                        is_html = True
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
                    content = self._extract_html_with_links(html_content)
                    is_html = True
                else:
                    content = payload.decode("utf-8", errors="ignore")

        # 清理内容（但保留换行和链接格式）
        if content:
            if not is_html:
                # 纯文本内容，只清理多余空白
                content = " ".join(content.split())
            # HTML转换的内容已经保留了格式，不需要过度清理

        return content

    def _extract_html_with_links(self, html_content: str) -> str:
        """
        从HTML中提取文本内容，转换为Markdown格式
        
        Args:
            html_content: HTML内容
            
        Returns:
            Markdown格式的内容
        """
        return self.html_to_markdown(html_content)

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

    def _extract_received_time_from_headers(self, msg: email.message.Message) -> Optional[datetime]:
        """
        从邮件头的Received字段中提取接收时间
        
        Received字段记录了邮件经过的服务器路径，通常最后一个Received字段的时间
        最接近邮件到达收件箱的时间。
        
        Args:
            msg: 邮件消息对象
            
        Returns:
            接收时间（datetime对象），如果无法提取则返回None
        """
        try:
            # 获取所有Received字段（可能有多个）
            received_headers = msg.get_all('Received', [])
            
            if not received_headers:
                logger.debug("邮件头中没有Received字段")
                return None
            
            # Received字段格式通常是：
            # "from server.example.com ([192.168.1.1]) by mail.example.com with ESMTP id xyz; Mon, 1 Jan 2024 12:00:00 +0800"
            # 或 "by mail.example.com for <user@example.com>; Mon, 1 Jan 2024 12:00:00 +0800"
            # 最后一个Received字段通常是最接近收件时间的
            
            # 尝试从最后一个Received字段提取时间
            last_received = received_headers[-1] if received_headers else None
            if not last_received:
                return None
            
            logger.debug(f"📅 最后一个Received字段: {last_received[:100]}...")
            
            # Received字段中的时间通常在分号后面
            # 尝试提取时间部分（通常在最后，格式如 "; Mon, 1 Jan 2024 12:00:00 +0800"）
            # 使用正则表达式匹配时间戳
            # 匹配格式: "; Mon, 1 Jan 2024 12:00:00 +0800" 或类似格式
            time_patterns = [
                r';\s*([A-Za-z]{3},\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+[+-]\d{4})',  # 标准格式
                r';\s*([A-Za-z]{3}\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+[+-]\d{4})',   # 无逗号格式
                r'([A-Za-z]{3},\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+[+-]\d{4})',      # 可能没有分号
            ]
            
            for pattern in time_patterns:
                match = re.search(pattern, last_received)
                if match:
                    time_str = match.group(1)
                    logger.debug(f"📅 从Received字段提取的时间字符串: {time_str}")
                    
                    # 尝试解析时间
                    received_time = self._parse_email_date(time_str)
                    if received_time:
                        logger.debug(f"✅ 成功从Received字段提取接收时间: {received_time}")
                        return received_time
            
            # 如果正则匹配失败，尝试直接解析整个Received字段
            # 有时时间可能在字段的其他位置
            logger.debug("尝试直接解析Received字段")
            received_time = self._parse_email_date(last_received)
            if received_time:
                logger.debug(f"✅ 成功解析Received字段: {received_time}")
                return received_time
            
            logger.warning(f"⚠️  无法从Received字段提取时间: {last_received[:100]}...")
            return None
            
        except Exception as e:
            logger.warning(f"⚠️  提取Received时间失败: {e}")
            return None

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
                # 从时间戳创建UTC时间
                dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
                # 转换为本地时间（UTC+8）
                local_tz = timezone(timedelta(hours=8))
                dt = dt.astimezone(local_tz).replace(tzinfo=None)
                return dt
        except Exception as e:
            logger.warning(f"⚠️  解析邮件日期失败: {date_str}, 错误: {e}")
        
        return None
