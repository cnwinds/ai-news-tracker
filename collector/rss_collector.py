"""
RSS数据采集器
"""
import feedparser
import requests
from datetime import datetime
from typing import List, Dict, Any, Tuple
import logging
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed
import re

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


class RSSCollector:
    """RSS采集器"""

    def __init__(self, timeout: int = 30, user_agent: str = None):
        self.timeout = timeout
        self.user_agent = user_agent or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

    def fetch_feed(self, url: str, max_articles: int = 20, source_name: str = None) -> List[Dict[str, Any]]:
        """
        从RSS源获取文章

        Args:
            url: RSS feed URL
            max_articles: 最大文章数
            source_name: 订阅源名称（将用作文章的source字段）

        Returns:
            文章列表
        """
        try:
            logger.info(f"📡 正在获取RSS: {url}")

            # 发送请求
            headers = {"User-Agent": self.user_agent}
            response = requests.get(url, headers=headers, timeout=self.timeout)
            response.raise_for_status()

            # 解析RSS
            feed = feedparser.parse(response.content)

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
            logger.error(f"❌ 请求失败 {url}: {e}")
            return []
        except Exception as e:
            logger.error(f"❌ 解析RSS失败 {url}: {e}")
            return []

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
            published_at = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                published_at = datetime(*entry.published_parsed[:6])
            elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
                published_at = datetime(*entry.updated_parsed[:6])

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
        清理HTML标签，保留纯文本

        Args:
            html: HTML字符串

        Returns:
            纯文本
        """
        try:
            soup = BeautifulSoup(html, "html.parser")
            return soup.get_text(separator=" ", strip=True)
        except Exception as e:
            logger.warning(f"⚠️  清理HTML失败: {e}")
            return html

    def _extract_date_from_page(self, soup: BeautifulSoup, url: str) -> datetime or None:
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

    def fetch_full_content(self, url: str) -> Tuple[str, datetime or None]:
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
                    # 取第一个匹配的元素
                    content = elements[0].get_text(separator=" ", strip=True)
                    if len(content) > 500:  # 确保内容足够长
                        break

            # 如果没找到，尝试获取body内容，但移除导航、侧边栏等
            if not content or len(content) < 500:
                # 移除不需要的元素
                for tag in soup.find_all(['nav', 'header', 'footer', 'aside', 'script', 'style']):
                    tag.decompose()
                content = soup.get_text(separator=" ", strip=True)

            # 清理多余空白
            content = " ".join(content.split())

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

    def fetch_multiple_feeds(self, feed_configs: List[Dict[str, Any]], max_workers: int = 5) -> Dict[str, Dict[str, Any]]:
        """
        批量获取多个RSS源（并发）

        Args:
            feed_configs: RSS配置列表
            max_workers: 最大并发数，默认5

        Returns:
            {source_name: {"articles": [articles], "feed_title": "feed title"}}
        """
        results = {}
        
        # 过滤启用的配置
        enabled_configs = [
            config for config in feed_configs 
            if config.get("enabled", True) and config.get("url")
        ]
        
        if not enabled_configs:
            logger.warning("⚠️  没有启用的RSS源")
            return results
        
        logger.info(f"🚀 开始并发获取 {len(enabled_configs)} 个RSS源（最大并发数: {max_workers}）")
        
        # 使用线程池并发获取
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # 提交所有任务
            future_to_config = {
                executor.submit(self._fetch_single_feed_with_info, config): config 
                for config in enabled_configs
            }
            
            # 收集结果
            completed = 0
            for future in as_completed(future_to_config):
                config = future_to_config[future]
                name = config.get("name", "Unknown")
                completed += 1
                
                try:
                    feed_result = future.result()
                    results[name] = feed_result
                    logger.info(f"✅ [{completed}/{len(enabled_configs)}] {name}: 获取 {len(feed_result.get('articles', []))} 篇文章 (feed title: {feed_result.get('feed_title', 'Unknown')})")
                except Exception as e:
                    logger.error(f"❌ [{completed}/{len(enabled_configs)}] {name}: 获取失败 - {e}")
                    results[name] = {"articles": [], "feed_title": None}
        
        logger.info(f"✅ RSS源获取完成，成功: {len([r for r in results.values() if r.get('articles')])}/{len(enabled_configs)}")
        return results
    
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
            headers = {"User-Agent": self.user_agent}
            response = requests.get(url, headers=headers, timeout=self.timeout)
            response.raise_for_status()

            # 解析RSS
            feed = feedparser.parse(response.content)

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
            logger.error(f"❌ 请求失败 {url}: {e}")
            return {"articles": [], "feed_title": None}
        except Exception as e:
            logger.error(f"❌ 解析RSS失败 {url}: {e}")
            return {"articles": [], "feed_title": None}
    
    def _fetch_single_feed(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        获取单个RSS源（用于并发执行）

        Args:
            config: RSS配置

        Returns:
            文章列表
        """
        name = config.get("name", "Unknown")
        url = config.get("url")
        max_articles = config.get("max_articles", 20)

        if not url:
            logger.warning(f"⚠️  {name} 没有配置URL")
            return []

        return self.fetch_feed(url, max_articles, source_name=name)
