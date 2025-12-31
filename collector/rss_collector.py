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
from concurrent.futures import ThreadPoolExecutor, as_completed

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

    def fetch_full_content(self, url: str) -> str:
        """
        获取文章的完整页面内容

        Args:
            url: 文章URL

        Returns:
            完整内容文本
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

            logger.info(f"✅ 成功获取完整内容，长度: {len(content)} 字符")
            return content

        except requests.RequestException as e:
            logger.warning(f"⚠️  获取完整内容失败 {url}: {e}")
            return ""
        except Exception as e:
            logger.warning(f"⚠️  解析完整内容失败 {url}: {e}")
            return ""

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
            
            # 提取文章信息
            articles = []
            for entry in feed.entries[:max_articles]:
                article = self._parse_entry(entry, feed.feed)
                if article:
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
        
        return self.fetch_feed(url, max_articles)
