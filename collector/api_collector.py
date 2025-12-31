"""
API数据采集器（arXiv, Hugging Face等）
"""
import requests
import feedparser
from datetime import datetime
from typing import List, Dict, Any
import logging
import time

logger = logging.getLogger(__name__)


class ArXivCollector:
    """arXiv论文采集器"""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.base_url = "http://export.arxiv.org/api/query"

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

            # 提取摘要
            summary = entry.get("summary", "")

            # arXiv ID
            arxiv_id = entry.get("id", "").split("/abs/")[-1] if "/abs/" in entry.get("id", "") else ""

            # PDF链接
            pdf_url = entry.get("link", "").replace("/abs/", "/pdf/") + ".pdf" if "/abs/" in entry.get("link", "") else ""

            # 发布时间
            published_at = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                published_at = datetime(*entry.published_parsed[:6])

            return {
                "title": entry.get("title", ""),
                "url": entry.get("id", ""),
                "content": summary,
                "source": "arXiv",
                "author": authors,
                "published_at": published_at,
                "category": "paper",
                "metadata": {
                    "arxiv_id": arxiv_id,
                    "pdf_url": pdf_url,
                    "primary_category": entry.get("arxiv_primary_category", {}).get("term", ""),
                    "categories": [tag.term for tag in entry.tags] if hasattr(entry, "tags") else [],
                },
            }

        except Exception as e:
            logger.error(f"❌ 解析arXiv论文失败: {e}")
            return None


class HuggingFaceCollector:
    """Hugging Face论文采集器"""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.base_url = "https://huggingface.co/api/papers"

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
            published_at = None
            if item.get("publishedAt"):
                try:
                    published_at = datetime.fromisoformat(item["publishedAt"].replace("Z", "+00:00"))
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


class PapersWithCodeCollector:
    """Papers with Code采集器"""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.base_url = "https://paperswithcode.com/api/v1"

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
