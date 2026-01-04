"""
Twitter/X 数据采集器
支持多种采集方案：
1. Nitter RSS（推荐，无需API密钥）
2. TodayRss（备选方案）
3. Twitter API（需要API密钥，付费）
"""
import requests
import re
from datetime import datetime
from typing import List, Dict, Any, Optional
import logging
import os

from backend.app.services.collector.rss_collector import RSSCollector

logger = logging.getLogger(__name__)


class TwitterCollector:
    """Twitter/X 采集器"""

    def __init__(self, timeout: int = 30, user_agent: str = None):
        self.timeout = timeout
        self.user_agent = user_agent or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        self.rss_collector = RSSCollector(timeout=timeout, user_agent=user_agent)
        
        # 从环境变量读取 Twitter API 配置（可选）
        self.twitter_bearer_token = os.getenv("TWITTER_BEARER_TOKEN", "")
        self.twitter_api_key = os.getenv("TWITTER_API_KEY", "")
        self.twitter_api_secret = os.getenv("TWITTER_API_SECRET", "")

    def fetch_tweets(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        从 Twitter/X 获取推文

        Args:
            config: 配置字典，包含:
                - url: Twitter 用户 URL (如 https://twitter.com/karpathy)
                - name: 源名称
                - method: 采集方法 ("nitter", "todayrss", "twitter_api", "auto")
                - nitter_instance: Nitter 实例 URL (可选，默认使用公共实例)
                - todayrss_api: TodayRss API URL (可选)
                - max_tweets: 最大推文数

        Returns:
            推文列表（格式化为文章格式）
        """
        url = config.get("url", "")
        name = config.get("name", "Unknown")
        method = config.get("method", "auto").lower()
        max_tweets = config.get("max_tweets", 20)

        if not url:
            logger.error(f"❌ {name}: 缺少 Twitter URL")
            return []

        # 从 URL 提取用户名
        username = self._extract_username(url)
        if not username:
            logger.error(f"❌ {name}: 无法从 URL 提取用户名: {url}")
            return []

        # 自动选择方法
        if method == "auto":
            method = self._select_best_method(config)

        logger.info(f"🐦 开始采集 Twitter: {name} (@{username}), 方法: {method}")

        try:
            if method == "nitter":
                articles = self._fetch_via_nitter(username, name, max_tweets, config)
            elif method == "todayrss":
                articles = self._fetch_via_todayrss(username, name, max_tweets, config)
            elif method == "twitter_api":
                articles = self._fetch_via_twitter_api(username, name, max_tweets, config)
            else:
                logger.error(f"❌ {name}: 不支持的采集方法: {method}")
                return []

            logger.info(f"✅ {name}: 成功获取 {len(articles)} 条推文")
            return articles

        except Exception as e:
            logger.error(f"❌ {name}: 采集失败 - {e}")
            import traceback
            traceback.print_exc()
            return []

    def _extract_username(self, url: str) -> Optional[str]:
        """从 Twitter URL 提取用户名"""
        patterns = [
            r"twitter\.com/([^/?]+)",
            r"x\.com/([^/?]+)",
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url, re.IGNORECASE)
            if match:
                username = match.group(1)
                # 移除可能的路径部分
                username = username.split("/")[0]
                return username
        
        return None

    def _select_best_method(self, config: Dict[str, Any]) -> str:
        """自动选择最佳的采集方法"""
        # 如果配置了 Twitter API 密钥，优先使用 API
        if self.twitter_bearer_token or (self.twitter_api_key and self.twitter_api_secret):
            return "twitter_api"
        
        # 如果配置了 Nitter 实例，使用 Nitter
        if config.get("nitter_instance"):
            return "nitter"
        
        # 默认使用 Nitter（公共实例）
        return "nitter"

    def _fetch_via_nitter(self, username: str, source_name: str, max_tweets: int, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        通过 Nitter 获取推文（转换为 RSS）

        Args:
            username: Twitter 用户名
            source_name: 源名称
            max_tweets: 最大推文数
            config: 配置字典

        Returns:
            文章列表
        """
        # 获取 Nitter 实例 URL
        nitter_instance = config.get("nitter_instance", "https://nitter.net")
        # 移除末尾的斜杠
        nitter_instance = nitter_instance.rstrip("/")
        
        # Nitter RSS URL 格式: https://nitter.net/username/rss
        rss_url = f"{nitter_instance}/{username}/rss"
        
        logger.info(f"  📡 使用 Nitter RSS: {rss_url}")
        
        # 使用 RSS 采集器获取
        rss_config = {
            "name": source_name,
            "url": rss_url,
            "max_articles": max_tweets,
        }
        
        feed_data = self.rss_collector.fetch_single_feed(rss_config)
        
        if feed_data and feed_data.get("articles"):
            articles = feed_data.get("articles", [])
            # 转换推文格式
            for article in articles:
                article["category"] = "social"
                # 确保作者字段是用户名
                if not article.get("author"):
                    article["author"] = f"@{username}"
            return articles
        
        return []

    def _fetch_via_todayrss(self, username: str, source_name: str, max_tweets: int, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        通过 TodayRss 获取推文

        Args:
            username: Twitter 用户名
            source_name: 源名称
            max_tweets: 最大推文数
            config: 配置字典

        Returns:
            文章列表
        """
        # TodayRss RSS URL 格式: https://todayrss.com/twitter/user/{username}
        todayrss_base = config.get("todayrss_api", "https://todayrss.com")
        todayrss_base = todayrss_base.rstrip("/")
        
        rss_url = f"{todayrss_base}/twitter/user/{username}"
        
        logger.info(f"  📡 使用 TodayRss: {rss_url}")
        
        # 使用 RSS 采集器获取
        rss_config = {
            "name": source_name,
            "url": rss_url,
            "max_articles": max_tweets,
        }
        
        feed_data = self.rss_collector.fetch_single_feed(rss_config)
        
        if feed_data and feed_data.get("articles"):
            articles = feed_data.get("articles", [])
            # 转换推文格式
            for article in articles:
                article["category"] = "social"
                if not article.get("author"):
                    article["author"] = f"@{username}"
            return articles
        
        return []

    def _fetch_via_twitter_api(self, username: str, source_name: str, max_tweets: int, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        通过 Twitter API 获取推文（需要 API 密钥）

        Args:
            username: Twitter 用户名
            source_name: 源名称
            max_tweets: 最大推文数
            config: 配置字典

        Returns:
            文章列表
        """
        if not self.twitter_bearer_token:
            logger.warning(f"  ⚠️  {source_name}: Twitter API 需要 Bearer Token，但未配置")
            return []

        try:
            # 首先获取用户 ID
            user_id = self._get_user_id_by_username(username)
            if not user_id:
                logger.error(f"  ❌ {source_name}: 无法获取用户 ID for @{username}")
                return []

            # 使用 Twitter API v2 获取推文
            api_url = "https://api.twitter.com/2/users/{}/tweets".format(user_id)
            headers = {
                "Authorization": f"Bearer {self.twitter_bearer_token}",
            }
            params = {
                "max_results": min(max_tweets, 100),  # API 限制最多 100
                "tweet.fields": "created_at,author_id,public_metrics,text",
                "exclude": "retweets,replies",  # 排除转推和回复
            }

            response = requests.get(api_url, headers=headers, params=params, timeout=self.timeout)
            response.raise_for_status()

            data = response.json()
            tweets = data.get("data", [])

            articles = []
            for tweet in tweets:
                article = {
                    "title": tweet.get("text", "")[:100] + "..." if len(tweet.get("text", "")) > 100 else tweet.get("text", ""),
                    "url": f"https://twitter.com/{username}/status/{tweet.get('id', '')}",
                    "content": tweet.get("text", ""),
                    "source": source_name,
                    "author": f"@{username}",
                    "published_at": datetime.fromisoformat(tweet.get("created_at", "").replace("Z", "+00:00")) if tweet.get("created_at") else None,
                    "category": "social",
                    "metadata": {
                        "tweet_id": tweet.get("id", ""),
                        "metrics": tweet.get("public_metrics", {}),
                    },
                }
                articles.append(article)

            logger.info(f"  ✅ 通过 Twitter API 获取 {len(articles)} 条推文")
            return articles

        except requests.RequestException as e:
            logger.error(f"  ❌ Twitter API 请求失败: {e}")
            return []
        except Exception as e:
            logger.error(f"  ❌ Twitter API 处理失败: {e}")
            return []

    def _get_user_id_by_username(self, username: str) -> Optional[str]:
        """通过用户名获取用户 ID"""
        try:
            api_url = "https://api.twitter.com/2/users/by/username/{}".format(username)
            headers = {
                "Authorization": f"Bearer {self.twitter_bearer_token}",
            }

            response = requests.get(api_url, headers=headers, timeout=self.timeout)
            response.raise_for_status()

            data = response.json()
            return data.get("data", {}).get("id")

        except Exception as e:
            logger.error(f"  ❌ 获取用户 ID 失败: {e}")
            return None


