"""
通用网页采集器
支持通过CSS选择器配置文章提取规则
"""
import requests
from bs4 import BeautifulSoup
from datetime import datetime
from typing import List, Dict, Any, Optional
import logging
import re

logger = logging.getLogger(__name__)


class WebCollector:
    """通用网页采集器"""

    def __init__(self, timeout: int = 30, user_agent: str = None):
        self.timeout = timeout
        self.user_agent = user_agent or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

    def fetch_articles(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        从网页获取文章

        Args:
            config: 配置字典，包含:
                - url: 网站URL
                - name: 源名称
                - article_selector: 文章列表的CSS选择器
                - title_selector: 标题的CSS选择器
                - link_selector: 链接的CSS选择器
                - date_selector: 日期的CSS选择器
                - content_selector: 内容的CSS选择器（可选）
                - author_selector: 作者的CSS选择器（可选）
                - max_articles: 最大文章数

        Returns:
            文章列表
        """
        url = config.get("url")
        name = config.get("name", "Unknown")
        article_selector = config.get("article_selector")
        max_articles = config.get("max_articles", 20)

        if not url or not article_selector:
            logger.error(f"❌ {name}: 缺少必要的配置 (url 或 article_selector)")
            return []

        try:
            logger.info(f"🌐 正在获取网页: {url}")

            headers = {"User-Agent": self.user_agent}
            response = requests.get(url, headers=headers, timeout=self.timeout)
            response.raise_for_status()

            soup = BeautifulSoup(response.content, "html.parser")

            articles = []
            article_elements = soup.select(article_selector)

            for i, element in enumerate(article_elements[:max_articles]):
                article = self._parse_article_element(element, config, name)
                if article:
                    # 如果配置了从详情页获取完整内容，则访问详情页
                    if config.get("fetch_full_content") and article.get("url"):
                        full_data = self._fetch_article_details(article["url"], config)
                        if full_data:
                            if full_data.get("content"):
                                article["content"] = full_data["content"]
                            if full_data.get("author") and not article.get("author"):
                                article["author"] = full_data["author"]
                            if full_data.get("published_at") and not article.get("published_at"):
                                article["published_at"] = full_data["published_at"]
                    articles.append(article)

            logger.info(f"✅ {name}: 成功获取 {len(articles)} 篇文章")
            return articles

        except requests.RequestException as e:
            logger.error(f"❌ 请求失败 {url}: {e}")
            return []
        except Exception as e:
            logger.error(f"❌ 解析网页失败 {url}: {e}")
            import traceback
            traceback.print_exc()
            return []

    def _parse_article_element(self, element: Any, config: Dict[str, Any], source_name: str) -> Dict[str, Any]:
        """
        解析单个文章元素

        Args:
            element: BeautifulSoup元素
            config: 配置字典
            source_name: 源名称

        Returns:
            文章字典
        """
        try:
            title_selector = config.get("title_selector")
            link_selector = config.get("link_selector")
            date_selector = config.get("date_selector")
            content_selector = config.get("content_selector")
            description_selector = config.get("description_selector")
            author_selector = config.get("author_selector")

            title = ""
            url = ""
            published_at = None
            author = ""
            content = ""

            if title_selector:
                title_elem = element.select_one(title_selector)
                if title_elem:
                    title = title_elem.get_text(strip=True)

            if link_selector:
                if link_selector == "self":
                    url = element.get("href", "")
                else:
                    link_elem = element.select_one(link_selector)
                    if link_elem:
                        url = link_elem.get("href", "")
                if url and not url.startswith("http"):
                    base_url = config.get("url")
                    url = self._resolve_url(url, base_url)

            if date_selector:
                date_elem = element.select_one(date_selector)
                if date_elem:
                    date_text = date_elem.get_text(strip=True)
                    published_at = self._parse_date(date_text)

            if author_selector:
                author_elem = element.select_one(author_selector)
                if author_elem:
                    author = author_elem.get_text(strip=True)

            if content_selector:
                content_elem = element.select_one(content_selector)
                if content_elem:
                    content = content_elem.get_text(strip=True)

            if description_selector and not content:
                desc_elem = element.select_one(description_selector)
                if desc_elem:
                    content = desc_elem.get_text(strip=True)

            if not title or not url:
                logger.warning(f"⚠️  文章缺少标题或URL: {title[:50] if title else 'N/A'}")
                return None

            return {
                "title": title,
                "url": url,
                "content": content,
                "source": source_name,
                "author": author,
                "published_at": published_at,
                "category": "rss",
            }

        except Exception as e:
            logger.error(f"❌ 解析文章元素失败: {e}")
            return None

    def _resolve_url(self, url: str, base_url: str) -> str:
        """
        解析相对URL为绝对URL

        Args:
            url: 可能是相对的URL
            base_url: 基础URL

        Returns:
            绝对URL
        """
        if url.startswith("//"):
            return "https:" + url
        elif url.startswith("/"):
            from urllib.parse import urljoin
            return urljoin(base_url, url)
        else:
            return url

    def _parse_date(self, date_text: str) -> Optional[datetime]:
        """
        解析日期字符串

        Args:
            date_text: 日期文本

        Returns:
            datetime对象或None
        """
        if not date_text:
            return None

        month_names = {
            "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
            "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12
        }

        date_patterns = [
            (r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}", "month_day_year"),
            r"\d{4}-\d{2}-\d{2}",
            r"\d{4}/\d{2}/\d{2}",
            r"\d{4}年\d{1,2}月\d{1,2}日",
            r"\d{2}-\d{2}-\d{4}",
            r"\d{2}/\d{2}/\d{4}",
        ]

        for pattern in date_patterns:
            if isinstance(pattern, tuple):
                pattern_str, format_type = pattern
            else:
                pattern_str = pattern
                format_type = "default"

            match = re.search(pattern_str, date_text)
            if match:
                date_str = match.group(0)
                try:
                    if format_type == "month_day_year":
                        parts = date_str.replace(",", "").split()
                        month = month_names.get(parts[0])
                        day = int(parts[1])
                        year = int(parts[2])
                        return datetime(year, month, day)
                    elif "年" in date_str:
                        parts = re.split(r"[年月日]", date_str)
                        return datetime(int(parts[0]), int(parts[1]), int(parts[2]))
                    elif "-" in date_str:
                        parts = date_str.split("-")
                        if len(parts) == 3 and len(parts[0]) == 4:
                            return datetime(int(parts[0]), int(parts[1]), int(parts[2]))
                        elif len(parts) == 3 and len(parts[2]) == 4:
                            return datetime(int(parts[2]), int(parts[0]), int(parts[1]))
                    elif "/" in date_str:
                        parts = date_str.split("/")
                        if len(parts) == 3 and len(parts[0]) == 4:
                            return datetime(int(parts[0]), int(parts[1]), int(parts[2]))
                        elif len(parts) == 3 and len(parts[2]) == 4:
                            return datetime(int(parts[2]), int(parts[0]), int(parts[1]))
                except Exception:
                    continue

        return None

    def _fetch_article_details(self, url: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        从详情页获取文章的完整内容、作者和日期

        Args:
            url: 文章URL
            config: 配置字典

        Returns:
            包含 content, author, published_at 的字典
        """
        try:
            logger.debug(f"📄 正在获取详情页内容: {url}")
            headers = {"User-Agent": self.user_agent}
            response = requests.get(url, headers=headers, timeout=self.timeout)
            response.raise_for_status()

            soup = BeautifulSoup(response.content, "html.parser")

            result = {}

            # 获取内容
            content_selector = config.get("content_selector")
            if content_selector:
                content_elem = soup.select_one(content_selector)
                if content_elem:
                    result["content"] = content_elem.get_text(separator=" ", strip=True)
            else:
                # 使用默认选择器
                content_selectors = [
                    'article .entry-content',
                    'article',
                    '.article-content',
                    '.post-content',
                    '.entry-content',
                    '.content',
                    'main article',
                    '[role="article"]',
                    '.blog-post-content',
                ]

                for selector in content_selectors:
                    elements = soup.select(selector)
                    if elements:
                        result["content"] = elements[0].get_text(separator=" ", strip=True)
                        if len(result["content"]) > 500:
                            break

                if not result.get("content") or len(result.get("content", "")) < 500:
                    for tag in soup.find_all(['nav', 'header', 'footer', 'aside', 'script', 'style']):
                        tag.decompose()
                    result["content"] = soup.get_text(separator=" ", strip=True)

            if result.get("content"):
                result["content"] = " ".join(result["content"].split())

            # 获取作者
            author_selector = config.get("author_selector")
            if author_selector:
                author_elem = soup.select_one(author_selector)
                if author_elem:
                    result["author"] = author_elem.get_text(strip=True)

            # 获取日期（如果列表页没有获取到）
            date_selector = config.get("date_selector")
            if date_selector:
                date_elem = soup.select_one(date_selector)
                if date_elem:
                    date_text = date_elem.get_text(strip=True)
                    if date_text:
                        result["published_at"] = self._parse_date(date_text)
                # 也尝试从 time 标签的 datetime 属性获取
                if not result.get("published_at"):
                    time_elem = soup.select_one("time[datetime]")
                    if time_elem:
                        datetime_attr = time_elem.get("datetime")
                        if datetime_attr:
                            try:
                                result["published_at"] = datetime.fromisoformat(datetime_attr.replace("Z", "+00:00"))
                            except:
                                pass

            return result

        except requests.RequestException as e:
            logger.warning(f"⚠️  获取详情页内容失败 {url}: {e}")
            return {}
        except Exception as e:
            logger.warning(f"⚠️  解析详情页内容失败 {url}: {e}")
            return {}

    def fetch_full_content(self, url: str) -> str:
        """
        获取文章的完整内容（兼容旧接口）

        Args:
            url: 文章URL

        Returns:
            完整内容文本
        """
        try:
            result = self._fetch_article_details(url, {})
            return result.get("content", "")
        except Exception as e:
            logger.warning(f"⚠️  获取完整内容失败 {url}: {e}")
            return ""

