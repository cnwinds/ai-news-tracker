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

from backend.app.services.collector.base_collector import BaseCollector

logger = logging.getLogger(__name__)


class WebCollector(BaseCollector):
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
    
    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        验证Web配置是否有效

        Args:
            config: 采集配置字典

        Returns:
            (is_valid, error_message) 元组
        """
        if not config.get("url"):
            return False, "Web配置中缺少url字段"
        if not config.get("article_selector"):
            return False, "Web配置中缺少article_selector字段"
        return True, None

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
                    content = self.html_to_markdown(str(content_elem))

            if description_selector and not content:
                desc_elem = element.select_one(description_selector)
                if desc_elem:
                    content = self.html_to_markdown(str(desc_elem))

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
                    result["content"] = self.html_to_markdown(str(content_elem))
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
                        result["content"] = self.html_to_markdown(str(elements[0]))
                        if len(result["content"]) > 500:
                            break

                if not result.get("content") or len(result.get("content", "")) < 500:
                    for tag in soup.find_all(['nav', 'header', 'footer', 'aside', 'script', 'style']):
                        tag.decompose()
                    result["content"] = self.html_to_markdown(str(soup))

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

    def _is_error_page(self, content: str, soup: BeautifulSoup) -> bool:
        """
        检查是否是错误页面（如需要JavaScript、访问被拒绝等）

        Args:
            content: 页面文本内容
            soup: BeautifulSoup对象

        Returns:
            如果是错误页面返回True
        """
        # 常见错误页面的特征
        error_indicators = [
            "JavaScript is not available",
            "JavaScript is disabled",
            "Please enable JavaScript",
            "Enable JavaScript to continue",
            "Access Denied",
            "Something went wrong",
            "let's give it another shot",
            "privacy related extensions may cause issues",
        ]

        content_lower = content.lower()

        # 检查是否包含错误提示
        for indicator in error_indicators:
            if indicator.lower() in content_lower:
                logger.warning(f"⚠️  检测到错误页面: '{indicator}'")
                return True

        # 检查页面标题是否包含错误信息
        title_tag = soup.find('title')
        if title_tag:
            title_text = title_tag.get_text().lower()
            for indicator in error_indicators:
                if indicator.lower() in title_text:
                    logger.warning(f"⚠️  页面标题显示错误: '{indicator}'")
                    return True

        # 检查页面内容过短（可能是错误页面）
        if len(content.strip()) < 200:
            logger.warning(f"⚠️  页面内容过短 ({len(content.strip())} 字符)，可能是错误页面")
            return True

        return False

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

            # 检查是否是错误页面
            content = result.get("content", "")
            if content:
                # 使用BeautifulSoup检查是否是错误页面
                soup = BeautifulSoup(content, "html.parser") if "<html" in content.lower() or "<body" in content.lower() else None
                if soup:
                    page_text = soup.get_text()
                    if self._is_error_page(page_text, soup):
                        logger.warning(f"⚠️  URL返回错误页面，跳过: {url}")
                        return ""

            return content
        except Exception as e:
            logger.warning(f"⚠️  获取完整内容失败 {url}: {e}")
            return ""

    def fetch_single_article(self, url: str) -> Optional[Dict[str, Any]]:
        """
        智能提取单个URL的文章内容（用于手动采集）

        Args:
            url: 文章URL

        Returns:
            文章字典，包含 title, url, content, author, published_at 等
        """
        try:
            logger.info(f"📄 正在采集文章: {url}")
            
            headers = {"User-Agent": self.user_agent}
            response = requests.get(url, headers=headers, timeout=self.timeout)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, "html.parser")
            
            # 提取标题
            title = ""
            title_selectors = [
                'h1.entry-title',
                'h1.post-title',
                'h1.article-title',
                'article h1',
                'main h1',
                'h1',
                'title'
            ]
            
            for selector in title_selectors:
                title_elem = soup.select_one(selector)
                if title_elem:
                    # 标题通常是纯文本，不需要Markdown转换
                    title = title_elem.get_text(strip=True)
                    if title and len(title) > 5:  # 确保标题有意义
                        break
            
            # 如果还没找到标题，尝试从title标签获取
            if not title or len(title) < 5:
                title_tag = soup.find('title')
                if title_tag:
                    title = title_tag.get_text(strip=True)
                    # 移除常见的后缀（如 " - Site Name"）
                    title = re.sub(r'\s*[-|]\s*.*$', '', title)
            
            if not title:
                title = url  # 如果还是找不到，使用URL作为标题
            
            # 提取内容
            content = ""
            content_selectors = [
                'article .entry-content',
                'article .post-content',
                'article .article-content',
                'article',
                '.article-content',
                '.post-content',
                '.entry-content',
                '.content',
                'main article',
                '[role="article"]',
                '.blog-post-content',
                '.post-body',
            ]
            
            for selector in content_selectors:
                elements = soup.select(selector)
                if elements:
                    content = self.html_to_markdown(str(elements[0]))
                    if len(content) > 500:  # 确保内容足够长
                        break
            
            # 如果还没找到足够的内容，尝试从main标签获取
            if not content or len(content) < 500:
                main_elem = soup.find('main')
                if main_elem:
                    # 移除导航、侧边栏等
                    for tag in main_elem.find_all(['nav', 'aside', 'script', 'style', 'header', 'footer']):
                        tag.decompose()
                    content = self.html_to_markdown(str(main_elem))
            
            # 如果还是不够，尝试从body获取（移除不需要的元素）
            if not content or len(content) < 500:
                for tag in soup.find_all(['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript']):
                    tag.decompose()
                body = soup.find('body')
                if body:
                    content = self.html_to_markdown(str(body))
            
            # 提取作者
            author = ""
            author_selectors = [
                '.author',
                '.post-author',
                '.article-author',
                '[rel="author"]',
                '.by-author',
                'meta[name="author"]',
            ]
            
            for selector in author_selectors:
                author_elem = soup.select_one(selector)
                if author_elem:
                    if selector.startswith('meta'):
                        author = author_elem.get('content', '')
                    else:
                        author = author_elem.get_text(strip=True)
                    if author:
                        break
            
            # 提取发布日期
            published_at = None
            
            # 尝试从time标签的datetime属性获取
            time_elem = soup.select_one("time[datetime]")
            if time_elem:
                datetime_attr = time_elem.get("datetime")
                if datetime_attr:
                    try:
                        published_at = datetime.fromisoformat(datetime_attr.replace("Z", "+00:00"))
                    except:
                        pass
            
            # 尝试从meta标签获取
            if not published_at:
                meta_date = soup.select_one('meta[property="article:published_time"]')
                if meta_date:
                    datetime_attr = meta_date.get("content")
                    if datetime_attr:
                        try:
                            published_at = datetime.fromisoformat(datetime_attr.replace("Z", "+00:00"))
                        except:
                            pass
            
            # 尝试从常见的选择器获取日期文本
            if not published_at:
                date_selectors = [
                    '.published',
                    '.post-date',
                    '.article-date',
                    '.date',
                    'time',
                ]
                for selector in date_selectors:
                    date_elem = soup.select_one(selector)
                    if date_elem:
                        date_text = date_elem.get_text(strip=True)
                        if date_text:
                            published_at = self._parse_date(date_text)
                            if published_at:
                                break
            
            logger.info(f"✅ 成功采集文章: {title[:50]}...")
            
            return {
                "title": title,
                "url": url,
                "content": content,
                "source": "手动采集-web页面",
                "author": author if author else None,
                "published_at": published_at,
                "category": "手动采集-web页面",
            }
            
        except requests.RequestException as e:
            logger.error(f"❌ 请求失败 {url}: {e}")
            return None
        except Exception as e:
            logger.error(f"❌ 解析文章失败 {url}: {e}")
            import traceback
            traceback.print_exc()
            return None

