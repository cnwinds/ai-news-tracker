"""
数据采集模块
"""
from collector.rss_collector import RSSCollector
from collector.api_collector import ArXivCollector, HuggingFaceCollector, PapersWithCodeCollector
from collector.service import CollectionService

__all__ = [
    "RSSCollector",
    "ArXivCollector",
    "HuggingFaceCollector",
    "PapersWithCodeCollector",
    "CollectionService",
]
