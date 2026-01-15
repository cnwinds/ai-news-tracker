"""
API数据采集器（arXiv, Hugging Face等）
"""
import requests
import feedparser
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
import logging
import time

from backend.app.services.collector.base_collector import BaseCollector

logger = logging.getLogger(__name__)


class ArXivCollector(BaseCollector):
    """arXiv论文采集器"""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.base_url = "http://export.arxiv.org/api/query"
    
    def fetch_articles(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        从arXiv获取论文（实现BaseCollector接口）

        Args:
            config: 采集配置字典，包含：
                - query: 查询条件 (如: cat:cs.AI)
                - max_results: 最大结果数（可选，默认20）

        Returns:
            论文列表
        """
        query = config.get("query")
        max_results = config.get("max_results", 20)
        
        if not query:
            raise ValueError("ArXiv配置中缺少query字段")
        
        return self.fetch_papers(query, max_results)
    
    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        验证ArXiv配置是否有效

        Args:
            config: 采集配置字典

        Returns:
            (is_valid, error_message) 元组
        """
        if not config.get("query"):
            return False, "ArXiv配置中缺少query字段"
        return True, None

    def fetch_papers(self, query: str, max_results: int = 20) -> List[Dict[str, Any]]:
        """
        从arXiv获取论文

        Args:
            query: 查询条件 (如: cat:cs.AI)
            max_results: 最大结果数

        Returns:
            论文列表
        """
        try:
            logger.info(f"📚 正在获取arXiv论文: {query}")

            params = {
                "search_query": query,
                "start": 0,
                "max_results": max_results,
                "sortBy": "submittedDate",
                "sortOrder": "descending",
            }

            response = requests.get(self.base_url, params=params, timeout=self.timeout)
            response.raise_for_status()

            # 解析Atom feed
            feed = feedparser.parse(response.content)

            papers = []
            for entry in feed.entries:
                paper = self._parse_arxiv_entry(entry)
                if paper:
                    papers.append(paper)

            logger.info(f"✅ 成功获取 {len(papers)} 篇arXiv论文")
            return papers

        except Exception as e:
            logger.error(f"❌ 获取arXiv论文失败: {e}")
            return []

    def _parse_arxiv_entry(self, entry: Any) -> Dict[str, Any]:
        """解析arXiv论文条目"""
        try:
            # 提取作者
            authors = ", ".join([author.name for author in entry.authors[:5]]) if hasattr(entry, "authors") else ""

            # 提取摘要（论文摘要内容）
            summary = entry.get("summary", "")

            # arXiv ID
            entry_id = entry.get("id", "")
            arxiv_id = entry_id.split("/abs/")[-1] if "/abs/" in entry_id else ""
            
            # HTML 页面地址（确保是 /abs/ 格式）
            html_url = entry_id
            if arxiv_id and "/abs/" not in html_url:
                # 如果 entry.id 不是 /abs/ 格式，构建 HTML URL
                html_url = f"http://arxiv.org/abs/{arxiv_id}"

            # PDF链接
            pdf_url = entry.get("link", "").replace("/abs/", "/pdf/") + ".pdf" if "/abs/" in entry.get("link", "") else ""
            if arxiv_id and not pdf_url:
                # 如果无法从 link 获取，根据 arxiv_id 构建 PDF URL
                pdf_url = f"http://arxiv.org/pdf/{arxiv_id}.pdf"

            # 发布时间
            # feedparser返回的时间是UTC时间，需要转换为本地时间（UTC+8）
            published_at = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                # 创建UTC时间对象
                utc_time = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
                # 转换为本地时间（UTC+8）
                local_tz = timezone(timedelta(hours=8))
                published_at = utc_time.astimezone(local_tz).replace(tzinfo=None)

            return {
                "title": entry.get("title", ""),
                "url": html_url,  # 使用 HTML 页面地址作为主 URL
                "content": summary,  # 将论文摘要作为文章内容，用于后续AI分析和中文总结
                "source": "arXiv",
                "author": authors,
                "published_at": published_at,
                "category": "paper",
                "metadata": {
                    "arxiv_id": arxiv_id,
                    "html_url": html_url,  # 明确添加 HTML 页面地址
                    "pdf_url": pdf_url,
                    "primary_category": entry.get("arxiv_primary_category", {}).get("term", ""),
                    "categories": [tag.term for tag in entry.tags] if hasattr(entry, "tags") else [],
                },
            }

        except Exception as e:
            logger.error(f"❌ 解析arXiv论文失败: {e}")
            return None


class HuggingFaceCollector(BaseCollector):
    """Hugging Face论文采集器"""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.base_url = "https://huggingface.co/api/papers"
    
    def fetch_articles(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        获取趋势论文（实现BaseCollector接口）

        Args:
            config: 采集配置字典，包含：
                - max_results: 最大数量（可选，默认20）

        Returns:
            论文列表
        """
        limit = config.get("max_results", 20)
        return self.fetch_trending_papers(limit)
    
    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        验证HuggingFace配置是否有效

        Args:
            config: 采集配置字典

        Returns:
            (is_valid, error_message) 元组
        """
        return True, None

    def fetch_trending_papers(self, limit: int = 20) -> List[Dict[str, Any]]:
        """
        获取趋势论文

        Args:
            limit: 最大数量

        Returns:
            论文列表
        """
        try:
            logger.info(f"🔥 正在获取Hugging Face趋势论文")

            url = f"{self.base_url}/trending"
            params = {"limit": limit}

            response = requests.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()

            data = response.json()

            papers = []
            for item in data:
                paper = self._parse_hf_paper(item)
                if paper:
                    papers.append(paper)

            logger.info(f"✅ 成功获取 {len(papers)} 篇Hugging Face趋势论文")
            return papers

        except Exception as e:
            logger.error(f"❌ 获取Hugging Face论文失败: {e}")
            return []

    def _parse_hf_paper(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """解析Hugging Face论文"""
        try:
            # 提取作者
            authors = item.get("authors", [])
            author_str = ", ".join(authors[:5]) + ("..." if len(authors) > 5 else "")

            # 发布时间
            # Hugging Face API返回的时间是UTC时间，需要转换为本地时间（UTC+8）
            published_at = None
            if item.get("publishedAt"):
                try:
                    # 解析UTC时间
                    utc_time = datetime.fromisoformat(item["publishedAt"].replace("Z", "+00:00"))
                    # 转换为本地时间（UTC+8）
                    local_tz = timezone(timedelta(hours=8))
                    published_at = utc_time.astimezone(local_tz).replace(tzinfo=None)
                except:
                    pass

            return {
                "title": item.get("title", ""),
                "url": item.get("paperUrl", ""),
                "content": item.get("summary", item.get("abstract", "")),
                "source": "Hugging Face",
                "author": author_str,
                "published_at": published_at,
                "category": "paper",
                "metadata": {
                    "hf_id": item.get("id", ""),
                    "likes": item.get("likesCount", 0),
                    "models": item.get("models", []),
                },
            }

        except Exception as e:
            logger.error(f"❌ 解析HF论文失败: {e}")
            return None


class PapersWithCodeCollector(BaseCollector):
    """Papers with Code采集器"""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.base_url = "https://paperswithcode.com/api/v1"
    
    def fetch_articles(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        获取趋势论文（实现BaseCollector接口）

        Args:
            config: 采集配置字典，包含：
                - max_results: 最大数量（可选，默认20）

        Returns:
            论文列表
        """
        limit = config.get("max_results", 20)
        return self.fetch_trending_papers(limit)
    
    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        验证PapersWithCode配置是否有效

        Args:
            config: 采集配置字典

        Returns:
            (is_valid, error_message) 元组
        """
        return True, None

    def fetch_trending_papers(self, limit: int = 20) -> List[Dict[str, Any]]:
        """获取趋势论文"""
        try:
            logger.info(f"📈 正在获取Papers with Code趋势论文")

            url = f"{self.base_url}/papers/"
            params = {"ordering": "-stars", "page_size": limit}

            response = requests.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()

            data = response.json()

            papers = []
            for item in data.get("results", []):
                paper = self._parse_pwc_paper(item)
                if paper:
                    papers.append(paper)

            logger.info(f"✅ 成功获取 {len(papers)} 篇Papers with Code论文")
            return papers

        except Exception as e:
            logger.error(f"❌ 获取Papers with Code失败: {e}")
            return []

    def _parse_pwc_paper(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """解析Papers with Code论文"""
        try:
            # 提取作者
            authors = item.get("authors", [])
            author_str = ", ".join([a["name"] for a in authors[:5]]) + ("..." if len(authors) > 5 else "")

            return {
                "title": item.get("title", ""),
                "url": f"https://paperswithcode.com/paper/{item['id']}",
                "content": item.get("abstract", ""),
                "source": "Papers with Code",
                "author": author_str,
                "published_at": None,
                "category": "paper",
                "metadata": {
                    "stars": item.get("stars", 0),
                    "tasks": [t["name"] for t in item.get("tasks", [])],
                    "methods": [m["name"] for m in item.get("methods", [])],
                },
            }

        except Exception as e:
            logger.error(f"❌ 解析PWC论文失败: {e}")
            return None
