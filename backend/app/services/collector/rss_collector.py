"""
RSS数据采集器
"""
import feedparser
import requests
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Tuple, Optional
import logging
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed
import re

from backend.app.services.collector.base_collector import BaseCollector

logger = logging.getLogger(__name__)


def _get_author_from_source(source_name: str = None, url: str = None) -> str:
    """
    根据源名称或URL确定正确的作者名称
    
    Args:
        source_name: 订阅源名称
        url: 文章URL
        
    Returns:
        作者名称，如果无法确定则返回空字符串
    """
    # 源名称到作者的映射
    source_to_author = {
        "Paul Graham": "Paul Graham",
        "paulgraham.com": "Paul Graham",
        "Paul Graham's Essays": "Paul Graham",
    }
    
    # URL到作者的映射
    url_to_author = {
        "paulgraham.com": "Paul Graham",
    }
    
    # 首先检查源名称
    if source_name:
        # 精确匹配
        if source_name in source_to_author:
            return source_to_author[source_name]
        # 部分匹配（包含关键词）
        for key, author in source_to_author.items():
            if key.lower() in source_name.lower():
                return author
    
    # 然后检查URL
    if url:
        for key, author in url_to_author.items():
            if key in url.lower():
                return author
    
    return ""


class RSSCollector(BaseCollector):
    """RSS采集器"""

    def __init__(self, timeout: int = 30, user_agent: str = None):
        self.timeout = timeout
        self.user_agent = user_agent or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        # 完整的浏览器请求头，用于绕过简单的反爬虫检测
        self.default_headers = {
            "User-Agent": self.user_agent,
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Referer": "https://www.google.com/",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
        }

    def fetch_articles(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        从RSS源获取文章（实现BaseCollector接口）

        Args:
            config: 采集配置字典，包含：
                - url: RSS feed URL
                - name: 源名称
                - max_articles: 最大文章数（可选，默认20）

        Returns:
            文章列表
        """
        url = config.get("url")
        source_name = config.get("name")
        max_articles = config.get("max_articles", 20)
        
        if not url:
            raise ValueError("RSS配置中缺少url字段")
        
        return self.fetch_feed(url, max_articles, source_name)
    
    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        验证RSS配置是否有效

        Args:
            config: 采集配置字典

        Returns:
            (is_valid, error_message) 元组
        """
        if not config.get("url"):
            return False, "RSS配置中缺少url字段"
        return True, None
    
    def fetch_feed(self, url: str, max_articles: int = 20, source_name: str = None) -> List[Dict[str, Any]]:
        """
        从RSS源获取文章（保留原有接口以保持向后兼容）

        Args:
            url: RSS feed URL
            max_articles: 最大文章数
            source_name: 订阅源名称（将用作文章的source字段）

        Returns:
            文章列表
        """
        try:
            logger.info(f"📡 正在获取RSS: {url}")

            # 发送请求（使用完整的浏览器请求头）
            # 对于 RSSHub 等可能需要验证的服务，使用更完整的请求头
            headers = self.default_headers.copy()
            # 如果是 RSSHub，添加特定的 Referer
            if "rsshub.app" in url or "rsshub" in url.lower():
                headers["Referer"] = "https://rsshub.app/"
            response = requests.get(url, headers=headers, timeout=self.timeout)
            response.raise_for_status()

            # 处理响应内容（确保正确解压）
            content = response.content
            content_encoding = response.headers.get('Content-Encoding', '').lower()
            
            # 如果响应是Brotli压缩但requests没有自动解压，手动解压
            if content_encoding == 'br':
                # 检查内容是否真的是压缩的（前几个字节是Brotli魔数）
                if content[:2] == b'\x81\x16' or content[:2] == b'\xce\xb2' or content[:1] == b'\xce':
                    try:
                        import brotli
                        content = brotli.decompress(content)
                        logger.debug("手动解压Brotli压缩内容")
                    except ImportError:
                        logger.warning("检测到Brotli压缩但未安装brotli库，请运行: pip install brotli")
                        # 尝试移除br从Accept-Encoding重新请求
                        headers_no_br = headers.copy()
                        if 'br' in headers_no_br.get('Accept-Encoding', ''):
                            accept_encoding = headers_no_br.get('Accept-Encoding', '')
                            accept_encoding = accept_encoding.replace('br', '').replace(',,', ',').strip(', ')
                            headers_no_br['Accept-Encoding'] = accept_encoding
                            logger.info("重新请求（不使用Brotli压缩）...")
                            response = requests.get(url, headers=headers_no_br, timeout=self.timeout)
                            response.raise_for_status()
                            content = response.content
                    except Exception as e:
                        logger.warning(f"Brotli解压失败: {e}，尝试重新请求（不使用Brotli）...")
                        # 尝试移除br从Accept-Encoding重新请求
                        headers_no_br = headers.copy()
                        if 'br' in headers_no_br.get('Accept-Encoding', ''):
                            accept_encoding = headers_no_br.get('Accept-Encoding', '')
                            accept_encoding = accept_encoding.replace('br', '').replace(',,', ',').strip(', ')
                            headers_no_br['Accept-Encoding'] = accept_encoding
                            response = requests.get(url, headers=headers_no_br, timeout=self.timeout)
                            response.raise_for_status()
                            content = response.content

            # 解析RSS
            feed = feedparser.parse(content)

            if feed.bozo:
                logger.warning(f"⚠️  RSS解析警告: {feed.bozo_exception}")

            # 提取文章信息
            articles = []
            for entry in feed.entries[:max_articles]:
                article = self._parse_entry(entry, feed.feed, source_name=source_name)
                if article:
                    articles.append(article)

            logger.info(f"✅ 成功获取 {len(articles)} 篇文章 from {url}")
            return articles

        except requests.RequestException as e:
            # 不在这里打印错误日志，让上层调用者统一处理
            # 抛出异常，让上层调用者能够捕获并记录失败
            raise
        except Exception as e:
            # 不在这里打印错误日志，让上层调用者统一处理
            # 抛出异常，让上层调用者能够捕获并记录失败
            raise

    def _parse_entry(self, entry: Any, feed_info: Any, source_name: str = None) -> Dict[str, Any]:
        """
        解析单篇文章

        Args:
            entry: feedparser entry
            feed_info: feed信息
            source_name: 订阅源名称（优先使用此作为source，而不是feed title）

        Returns:
            文章字典
        """
        try:
            # 基本字段
            title = entry.get("title", "无标题")
            url = entry.get("link", "")
            author = entry.get("author", "")

            # 发布时间
            # feedparser返回的时间是UTC时间，需要转换为本地时间（UTC+8）
            published_at = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                # 创建UTC时间对象
                utc_time = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
                # 转换为本地时间（UTC+8）
                local_tz = timezone(timedelta(hours=8))
                published_at = utc_time.astimezone(local_tz).replace(tzinfo=None)
            elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
                # 创建UTC时间对象
                utc_time = datetime(*entry.updated_parsed[:6], tzinfo=timezone.utc)
                # 转换为本地时间（UTC+8）
                local_tz = timezone(timedelta(hours=8))
                published_at = utc_time.astimezone(local_tz).replace(tzinfo=None)

            # 内容提取
            content = ""
            if hasattr(entry, "content") and entry.content:
                content = entry.content[0].value if isinstance(entry.content, list) else entry.content
            elif hasattr(entry, "summary"):
                content = entry.summary
            elif hasattr(entry, "description"):
                content = entry.description

            # 清理HTML标签
            content = self._clean_html(content)

            # 来源：优先使用传入的订阅源名称，否则使用feed title
            source = source_name if source_name else feed_info.get("title", "Unknown")
            
            # 根据源名称或URL确定正确的作者（如果RSS feed中的author不准确）
            correct_author = _get_author_from_source(source_name, url)
            if correct_author:
                author = correct_author
            # 如果RSS feed中没有author，但可以根据源名称确定，则使用确定的作者
            elif not author and correct_author:
                author = correct_author

            return {
                "title": title,
                "url": url,
                "content": content,
                "source": source,
                "author": author,
                "published_at": published_at,
                "category": "rss",
            }

        except Exception as e:
            logger.error(f"❌ 解析文章失败: {e}")
            return None

    def _clean_html(self, html: str) -> str:
        """
        将HTML转换为Markdown格式

        Args:
            html: HTML字符串

        Returns:
            Markdown格式的字符串
        """
        if not html:
            return ""
        return self.html_to_markdown(html)

    def _extract_date_from_page(self, soup: BeautifulSoup, url: str) -> Optional[datetime]:
        """
        从页面HTML中提取发布日期

        Args:
            soup: BeautifulSoup对象
            url: 页面URL（用于判断是否需要特殊处理）

        Returns:
            datetime对象或None
        """
        try:
            text = soup.get_text()

            month_names = [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'
            ]

            month_to_num = {
                'January': 1, 'February': 2, 'March': 3, 'April': 4,
                'May': 5, 'June': 6, 'July': 7, 'August': 8,
                'September': 9, 'October': 10, 'November': 11, 'December': 12
            }

            # Paul Graham的日期格式: "Month YYYY" (如 "October 2023")
            if 'paulgraham.com' in url:
                date_pattern = r'(' + '|'.join(month_names) + r')\s+(\d{4})'
                match = re.search(date_pattern, text, re.IGNORECASE)
                if match:
                    month_str = match.group(1)
                    year = int(match.group(2))
                    month_num = month_to_num.get(month_str.capitalize())
                    if month_num:
                        return datetime(year, month_num, 1)

            return None

        except Exception as e:
            logger.warning(f"⚠️  提取日期失败: {e}")
            return None

    def fetch_full_content(self, url: str) -> Tuple[str, Optional[datetime]]:
        """
        获取文章的完整页面内容和发布日期

        Args:
            url: 文章URL

        Returns:
            (完整内容文本, 发布时间) 的元组
        """
        try:
            logger.info(f"📄 正在获取完整内容: {url}")
            headers = {"User-Agent": self.user_agent}
            response = requests.get(url, headers=headers, timeout=self.timeout)
            response.raise_for_status()

            # 解析HTML
            soup = BeautifulSoup(response.content, "html.parser")

            # 尝试找到主要内容区域
            # 常见的文章内容选择器
            content_selectors = [
                'article',
                '.article-content',
                '.post-content',
                '.entry-content',
                '.content',
                'main article',
                '[role="article"]',
                '.blog-post-content',
            ]

            content = ""
            for selector in content_selectors:
                elements = soup.select(selector)
                if elements:
                    # 取第一个匹配的元素，转换为Markdown
                    content = self.html_to_markdown(str(elements[0]))
                    if len(content) > 500:  # 确保内容足够长
                        break

            # 如果没找到，尝试获取body内容，但移除导航、侧边栏等
            if not content or len(content) < 500:
                # 移除不需要的元素
                for tag in soup.find_all(['nav', 'header', 'footer', 'aside', 'script', 'style']):
                    tag.decompose()
                content = self.html_to_markdown(str(soup))

            # 尝试从页面提取发布日期
            published_at = self._extract_date_from_page(soup, url)

            logger.info(f"✅ 成功获取完整内容，长度: {len(content)} 字符" + (f"，日期: {published_at}" if published_at else ""))
            return content, published_at

        except requests.RequestException as e:
            logger.warning(f"⚠️  获取完整内容失败 {url}: {e}")
            return "", None
        except Exception as e:
            logger.warning(f"⚠️  解析完整内容失败 {url}: {e}")
            return "", None

    def fetch_single_feed(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        获取单个RSS源（公开接口）

        Args:
            config: RSS配置，包含 name, url, max_articles 等字段

        Returns:
            {"articles": [articles], "feed_title": "feed title"}
        """
        return self._fetch_single_feed_with_info(config)

    def _fetch_single_feed_with_info(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        获取单个RSS源（包含feed信息，用于并发执行）

        Args:
            config: RSS配置

        Returns:
            {"articles": [articles], "feed_title": "feed title"}
        """
        name = config.get("name", "Unknown")
        url = config.get("url")
        max_articles = config.get("max_articles", 20)

        if not url:
            logger.warning(f"⚠️  {name} 没有配置URL")
            return {"articles": [], "feed_title": None}

        try:
            # 获取feed信息（只请求一次）
            # 使用完整的浏览器请求头
            headers = self.default_headers.copy()
            # 如果是 RSSHub，添加特定的 Referer
            if "rsshub.app" in url or "rsshub" in url.lower():
                headers["Referer"] = "https://rsshub.app/"
            response = requests.get(url, headers=headers, timeout=self.timeout)
            response.raise_for_status()

            # 处理响应内容（确保正确解压）
            content = response.content
            content_encoding = response.headers.get('Content-Encoding', '').lower()
            
            # 如果响应是Brotli压缩但requests没有自动解压，手动解压
            if content_encoding == 'br':
                # 检查内容是否真的是压缩的（前几个字节是Brotli魔数）
                if content[:2] == b'\x81\x16' or content[:2] == b'\xce\xb2' or content[:1] == b'\xce':
                    try:
                        import brotli
                        content = brotli.decompress(content)
                        logger.debug("手动解压Brotli压缩内容")
                    except ImportError:
                        logger.warning("检测到Brotli压缩但未安装brotli库，请运行: pip install brotli")
                        # 尝试移除br从Accept-Encoding重新请求
                        headers_no_br = headers.copy()
                        if 'br' in headers_no_br.get('Accept-Encoding', ''):
                            accept_encoding = headers_no_br.get('Accept-Encoding', '')
                            accept_encoding = accept_encoding.replace('br', '').replace(',,', ',').strip(', ')
                            headers_no_br['Accept-Encoding'] = accept_encoding
                            logger.info("重新请求（不使用Brotli压缩）...")
                            response = requests.get(url, headers=headers_no_br, timeout=self.timeout)
                            response.raise_for_status()
                            content = response.content
                    except Exception as e:
                        logger.warning(f"Brotli解压失败: {e}，尝试重新请求（不使用Brotli）...")
                        # 尝试移除br从Accept-Encoding重新请求
                        headers_no_br = headers.copy()
                        if 'br' in headers_no_br.get('Accept-Encoding', ''):
                            accept_encoding = headers_no_br.get('Accept-Encoding', '')
                            accept_encoding = accept_encoding.replace('br', '').replace(',,', ',').strip(', ')
                            headers_no_br['Accept-Encoding'] = accept_encoding
                            response = requests.get(url, headers=headers_no_br, timeout=self.timeout)
                            response.raise_for_status()
                            content = response.content

            # 解析RSS
            feed = feedparser.parse(content)

            if feed.bozo:
                logger.warning(f"⚠️  RSS解析警告: {feed.bozo_exception}")

            # 获取feed title
            feed_title = feed.feed.get("title", None) if hasattr(feed, 'feed') else None

            # 提取文章信息（使用订阅源名称作为source）
            # 注意：每个线程都会创建独立的feed对象，不会共享
            articles = []
            for entry in feed.entries[:max_articles]:
                # 确保传入正确的source_name，防止并发时使用错误的名称
                article = self._parse_entry(entry, feed.feed, source_name=name)
                if article:
                    # 防御性检查：确保article的source字段与传入的name一致
                    if article.get("source") != name:
                        logger.warning(f"  ⚠️  RSS解析时source不匹配: 期望={name}, 实际={article.get('source')}, URL={article.get('url', '')[:50]}")
                        article["source"] = name  # 强制修正
                    articles.append(article)

            logger.info(f"✅ 成功获取 {len(articles)} 篇文章 from {url}")
            return {"articles": articles, "feed_title": feed_title}

        except requests.RequestException as e:
            # 不在这里打印错误日志，让上层调用者统一处理
            # 抛出异常，让上层调用者能够捕获并记录失败
            raise
        except Exception as e:
            # 不在这里打印错误日志，让上层调用者统一处理
            # 抛出异常，让上层调用者能够捕获并记录失败
            raise
