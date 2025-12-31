"""
RSS数据采集器
"""
import feedparser
import requests
from datetime import datetime
from typing import List, Dict, Any
from urllib.parse import urljoin
import logging
from bs4 import BeautifulSoup
from time import sleep

logger = logging.getLogger(__name__)


class RSSCollector:
    """RSS采集器"""

    def __init__(self, timeout: int = 30, user_agent: str = None):
        self.timeout = timeout
        self.user_agent = user_agent or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

    def fetch_feed(self, url: str, max_articles: int = 20) -> List[Dict[str, Any]]:
        """
        从RSS源获取文章

        Args:
            url: RSS feed URL
            max_articles: 最大文章数

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
                article = self._parse_entry(entry, feed.feed)
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

    def _parse_entry(self, entry: Any, feed_info: Any) -> Dict[str, Any]:
        """
        解析单篇文章

        Args:
            entry: feedparser entry
            feed_info: feed信息

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

            # 来源
            source = feed_info.get("title", "Unknown")

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

    def fetch_multiple_feeds(self, feed_configs: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """
        批量获取多个RSS源

        Args:
            feed_configs: RSS配置列表

        Returns:
            {source_name: [articles]}
        """
        results = {}

        for config in feed_configs:
            if not config.get("enabled", True):
                continue

            name = config.get("name", "Unknown")
            url = config.get("url")
            max_articles = config.get("max_articles", 20)

            if not url:
                logger.warning(f"⚠️  {name} 没有配置URL")
                continue

            articles = self.fetch_feed(url, max_articles)
            results[name] = articles

            # 避免请求过快
            sleep(1)

        return results
