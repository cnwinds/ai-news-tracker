"""
Twitter/X 数据采集器
支持多种采集方案：
1. Nitter RSS（推荐，无需API密钥）
2. TodayRss（备选方案）
3. Twitter API（需要API密钥，付费）
4. TwitterAPI.io（支持搜索热门帖子，需要API密钥）
"""
import requests
import re
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
import logging
import os
from email.utils import parsedate_to_datetime

from backend.app.services.collector.base_collector import BaseCollector
from backend.app.services.collector.rss_collector import RSSCollector

logger = logging.getLogger(__name__)


class TwitterCollector(BaseCollector):
    """Twitter/X 采集器"""

    def __init__(self, timeout: int = 30, user_agent: str = None):
        self.timeout = timeout
        self.user_agent = user_agent or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        self.rss_collector = RSSCollector(timeout=timeout, user_agent=user_agent)
        
        # 从环境变量读取 Twitter API 配置（可选）
        self.twitter_bearer_token = os.getenv("TWITTER_BEARER_TOKEN", "")
        self.twitter_api_key = os.getenv("TWITTER_API_KEY", "")
        self.twitter_api_secret = os.getenv("TWITTER_API_SECRET", "")

    def _convert_utc_to_local(self, utc_time_str: str) -> Optional[datetime]:
        """
        将UTC时间字符串转换为本地时间（UTC+8）
        
        Args:
            utc_time_str: UTC时间字符串（支持多种格式：
                - ISO格式: "2025-01-05T13:08:26Z"
                - Twitter格式: "Tue Jan 13 22:38:17 +0000 2026"
            )
            
        Returns:
            本地时间的datetime对象（naive datetime）
        """
        if not utc_time_str:
            return None
            
        try:
            # 尝试解析 Twitter 标准格式: "Tue Jan 13 22:38:17 +0000 2026"
            if "+0000" in utc_time_str or utc_time_str.count(" ") >= 5:
                # 使用 email.utils.parsedate_to_datetime 解析 Twitter 时间格式
                utc_time = parsedate_to_datetime(utc_time_str)
                if utc_time:
                    # 转换为本地时间（UTC+8）
                    local_tz = timezone(timedelta(hours=8))
                    return utc_time.astimezone(local_tz).replace(tzinfo=None)
            
            # 尝试解析 ISO 格式
            utc_time = datetime.fromisoformat(utc_time_str.replace("Z", "+00:00"))
            # 转换为本地时间（UTC+8）
            local_tz = timezone(timedelta(hours=8))
            return utc_time.astimezone(local_tz).replace(tzinfo=None)
        except Exception as e:
            logger.warning(f"⚠️  时间转换失败: {utc_time_str}, 错误: {e}")
            return None
    
    def fetch_articles(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        从 Twitter/X 获取推文（实现BaseCollector接口）

        Args:
            config: 采集配置字典，包含：
                - url: Twitter 用户 URL
                - name: 源名称
                - method: 采集方法（可选）
                - max_tweets: 最大推文数（可选，默认20）

        Returns:
            推文列表（格式化为文章格式）
        """
        # 将max_tweets映射到max_articles（如果存在）
        if "max_articles" in config and "max_tweets" not in config:
            config["max_tweets"] = config["max_articles"]
        
        return self.fetch_tweets(config)
    
    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        验证Twitter配置是否有效

        Args:
            config: 采集配置字典

        Returns:
            (is_valid, error_message) 元组
        """
        method = config.get("method", "auto").lower()
        
        # twitterapi_io 方法不需要 url（使用 API 搜索热门帖子，不是特定用户）
        # 需要 query 和 api_key
        if method == "twitterapi_io":
            if not config.get("query"):
                return False, "TwitterAPI.io配置中缺少query字段（搜索关键字）"
            if not config.get("api_key"):
                return False, "TwitterAPI.io配置中缺少api_key字段（API密钥）"
            return True, None
        
        # 其他方法需要 url（用于提取用户名）
        if not config.get("url"):
            return False, "Twitter配置中缺少url字段"
        return True, None

    def fetch_tweets(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        从 Twitter/X 获取推文

        Args:
            config: 配置字典，包含:
                - url: Twitter 用户 URL (如 https://twitter.com/karpathy) - 对于 twitterapi_io 方法不需要
                - name: 源名称
                - method: 采集方法 ("nitter", "todayrss", "twitter_api", "twitterapi_io", "auto")
                - nitter_instance: Nitter 实例 URL (可选，默认使用公共实例)
                - todayrss_api: TodayRss API URL (可选)
                - max_tweets: 最大推文数
                - query: 搜索关键字（twitterapi_io 方法必需）
                - api_key: API密钥（twitterapi_io 方法必需）
                - queryType: 查询类型（twitterapi_io 方法可选，默认 "Top"）
                - cursor: 分页游标（twitterapi_io 方法可选，默认 "="）

        Returns:
            推文列表（格式化为文章格式）
        """
        name = config.get("name", "Unknown")
        method = config.get("method", "auto").lower()
        max_tweets = config.get("max_tweets", 20)

        # twitterapi_io 方法不需要 url
        if method == "twitterapi_io":
            logger.info(f"🐦 开始采集 Twitter 热门帖子: {name}, 方法: {method}")
            try:
                articles = self._fetch_via_twitterapi_io(name, max_tweets, config)
                logger.info(f"✅ {name}: 成功获取 {len(articles)} 条推文")
                return articles
            except Exception as e:
                logger.error(f"❌ {name}: 采集失败 - {e}")
                import traceback
                traceback.print_exc()
                return []

        # 其他方法需要 url
        url = config.get("url", "")
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
                    "published_at": self._convert_utc_to_local(tweet.get("created_at")) if tweet.get("created_at") else None,
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

    def _fetch_via_twitterapi_io(self, source_name: str, max_tweets: int, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        通过 TwitterAPI.io 获取热门推文

        Args:
            source_name: 源名称
            max_tweets: 最大推文数
            config: 配置字典，包含:
                - query: 搜索关键字（必需）
                - api_key: API密钥（必需）
                - queryType: 查询类型，默认为 "Top"（热门）
                - cursor: 分页游标，默认为 "="

        Returns:
            文章列表
        """
        query = config.get("query", "")
        api_key = config.get("api_key", "")
        # 默认使用 Latest，因为 Top 可能需要更多参数或权限
        query_type = config.get("queryType", "Latest")
        cursor = config.get("cursor", "")

        if not query:
            logger.error(f"  ❌ {source_name}: TwitterAPI.io 需要 query 参数")
            return []

        if not api_key:
            logger.error(f"  ❌ {source_name}: TwitterAPI.io 需要 api_key 参数")
            return []

        try:
            api_url = "https://api.twitterapi.io/twitter/tweet/advanced_search"
            headers = {
                "X-API-Key": api_key,  # 根据 TwitterAPI.io 文档，使用 X-API-Key 作为认证头
            }
            params = {
                "query": query,
                "queryType": query_type,
            }
            # 只有在 cursor 不是初始值时才添加 cursor 参数
            if cursor and cursor != "=" and cursor:
                params["cursor"] = cursor

            logger.info(f"  📡 使用 TwitterAPI.io 搜索: query={query}, queryType={query_type}")

            response = requests.get(api_url, headers=headers, params=params, timeout=self.timeout)
            response.raise_for_status()
            
            data = response.json()
            
            # 检查是否有错误信息
            if "error" in data:
                logger.error(f"  ❌ API 返回错误: {data.get('error')}")
                return []
            
            # 获取推文数据
            tweets = data.get("tweets", [])
            if not tweets:
                # 尝试其他可能的键名
                tweets = data.get("data", [])
                if not tweets:
                    logger.warning(f"  ⚠️  未找到推文数据")
                    return []

            articles = []
            for idx, tweet in enumerate(tweets[:max_tweets]):  # 限制返回数量
                try:
                    author = tweet.get("author", {})
                    author_name = author.get("userName", "Unknown")
                    author_display_name = author.get("name", author_name)
                    
                    # 解析时间
                    created_at_str = tweet.get("createdAt", "")
                    published_at = None
                    if created_at_str:
                        published_at = self._convert_utc_to_local(created_at_str)

                    # 获取推文正文（text 字段包含完整内容，不会被截断）
                    tweet_text = tweet.get("text", "")
                    tweet_url = tweet.get("url", "")
                    tweet_id = tweet.get("id", "")
                    
                    # 处理引用推文和转推，构建完整内容
                    quoted_tweet = tweet.get("quoted_tweet")
                    retweeted_tweet = tweet.get("retweeted_tweet")
                    
                    # 构建完整内容
                    full_content = tweet_text
                    
                    # 如果有引用推文，添加到内容中
                    if quoted_tweet:
                        quoted_text = quoted_tweet.get("text", "")
                        quoted_author = quoted_tweet.get("author", {})
                        quoted_author_name = quoted_author.get("userName", "Unknown")
                        if quoted_text:
                            full_content += f"\n\n📎 引用推文 (@{quoted_author_name}):\n{quoted_text}"
                    
                    # 如果有转推，添加原推文内容
                    if retweeted_tweet:
                        retweeted_text = retweeted_tweet.get("text", "")
                        retweeted_author = retweeted_tweet.get("author", {})
                        retweeted_author_name = retweeted_author.get("userName", "Unknown")
                        if retweeted_text:
                            # 如果原推文有内容，显示转推说明和原推文
                            if tweet_text:
                                full_content = f"{tweet_text}\n\n🔄 转推自 @{retweeted_author_name}:\n{retweeted_text}"
                            else:
                                # 如果没有转推评论，直接显示原推文
                                full_content = f"🔄 转推自 @{retweeted_author_name}:\n{retweeted_text}"

                    article = {
                        "title": tweet_text[:100] + "..." if len(tweet_text) > 100 else tweet_text,
                        "url": tweet_url or f"https://twitter.com/{author_name}/status/{tweet_id}",
                        "content": full_content,  # 使用完整内容（包含引用推文和转推）
                        "source": source_name,
                        "author": f"@{author_name}",
                        "published_at": published_at,
                        "category": "social",
                        "metadata": {
                            "tweet_id": tweet_id,
                            "retweet_count": tweet.get("retweetCount", 0),
                            "reply_count": tweet.get("replyCount", 0),
                            "like_count": tweet.get("likeCount", 0),
                            "quote_count": tweet.get("quoteCount", 0),
                            "view_count": tweet.get("viewCount", 0),
                            "author_display_name": author_display_name,
                            "author_verified": author.get("isBlueVerified", False),
                            "is_reply": tweet.get("isReply", False),
                            "has_quoted_tweet": quoted_tweet is not None,
                            "has_retweeted_tweet": retweeted_tweet is not None,
                        },
                    }
                    articles.append(article)
                except Exception as e:
                    logger.error(f"  ❌ 处理推文 {idx+1} 时出错: {e}")
                    continue

            logger.info(f"  ✅ 通过 TwitterAPI.io 获取 {len(articles)} 条推文")
            return articles

        except requests.RequestException as e:
            logger.error(f"  ❌ TwitterAPI.io 请求失败: {e}")
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_data = e.response.json()
                    logger.error(f"  错误详情: {error_data}")
                except (ValueError, KeyError, AttributeError):
                    logger.error(f"  响应内容: {e.response.text if hasattr(e, 'response') and e.response else 'N/A'}")
            return []
        except Exception as e:
            logger.error(f"  ❌ TwitterAPI.io 处理失败: {e}")
            import traceback
            traceback.print_exc()
            return []


