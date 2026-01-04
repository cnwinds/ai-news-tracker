"""
订阅源导入模块
从配置文件加载默认的订阅源列表（支持rss/api/web/social所有类型）
"""
import json
from pathlib import Path
from typing import List, Dict, Any
from backend.app.core.paths import APP_ROOT

# 获取配置文件路径（sources.json 在 backend/app 目录）
CONFIG_PATH = APP_ROOT / "sources.json"


def load_sources(source_type: str = "rss") -> List[Dict[str, Any]]:
    """
    从配置文件加载指定类型的源列表

    Args:
        source_type: 源类型 (rss/api/web/social)

    Returns:
        源列表，每个源包含 name, url, description, category, tier, language, priority, enabled, source_type 等字段

    注意：每次调用都重新读取配置文件，避免全局变量在多进程/多线程环境下的并发问题
    """
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)

        source_key = f"{source_type}_sources"
        sources = config.get(source_key, [])

        # 转换格式，确保所有必需字段都存在
        formatted_sources = []
        for source in sources:
            # 提取 extra_config（如果存在）
            extra_config = source.get("extra_config", {})
            if isinstance(extra_config, str):
                try:
                    extra_config = json.loads(extra_config)
                except:
                    extra_config = {}
            
            # 如果没有 extra_config，尝试从顶层字段读取（向后兼容）
            if not extra_config:
                extra_fields = {}
                
                # API源的扩展字段
                if source_type == "api":
                    if source.get("query"):
                        extra_fields["query"] = source.get("query")
                    if source.get("max_results"):
                        extra_fields["max_results"] = source.get("max_results")
                    if source.get("endpoint"):
                        extra_fields["endpoint"] = source.get("endpoint")
                
                # Web源的扩展字段
                elif source_type == "web":
                    if source.get("article_selector"):
                        extra_fields["article_selector"] = source.get("article_selector")
                    if source.get("title_selector"):
                        extra_fields["title_selector"] = source.get("title_selector")
                    if source.get("link_selector"):
                        extra_fields["link_selector"] = source.get("link_selector")
                    if source.get("date_selector"):
                        extra_fields["date_selector"] = source.get("date_selector")
                    if source.get("content_selector"):
                        extra_fields["content_selector"] = source.get("content_selector")
                    if source.get("description_selector"):
                        extra_fields["description_selector"] = source.get("description_selector")
                    if source.get("author_selector"):
                        extra_fields["author_selector"] = source.get("author_selector")
                    if source.get("max_articles"):
                        extra_fields["max_articles"] = source.get("max_articles")
                
                # 社交源的扩展字段
                elif source_type == "social":
                    if source.get("platform"):
                        extra_fields["platform"] = source.get("platform")
                    if source.get("search_query"):
                        extra_fields["search_query"] = source.get("search_query")
                
                if extra_fields:
                    extra_config = extra_fields
            
            # 处理 description：优先使用 description，如果没有则使用 note（向后兼容）
            description = source.get("description", "")
            if not description:
                description = source.get("note", "")
            
            formatted_source = {
                "name": source.get("name", ""),
                "url": source.get("url", ""),
                "description": description,
                "category": source.get("category", "other"),
                "tier": source.get("tier", "tier3"),
                "source_type": source_type,
                "language": source.get("language", "en"),
                "priority": source.get("priority", 3),
                "enabled": source.get("enabled", True),
            }
            
            # 如果有 extra_config，将其序列化为JSON字符串
            if extra_config:
                formatted_source["extra_config"] = json.dumps(extra_config, ensure_ascii=False)
            else:
                formatted_source["extra_config"] = ""
            
            formatted_sources.append(formatted_source)

        return formatted_sources
    except FileNotFoundError:
        print(f"⚠️ 配置文件未找到: {CONFIG_PATH}")
        return []
    except json.JSONDecodeError as e:
        print(f"❌ JSON解析错误: {e}")
        return []
    except Exception as e:
        print(f"❌ 加载订阅源失败: {e}")
        return []


def load_rss_sources() -> List[Dict[str, Any]]:
    """
    从配置文件加载RSS源列表

    Returns:
        RSS源列表，每个源包含 name, url, description, category, tier, language, priority, enabled 等字段

    注意：每次调用都重新读取配置文件，避免全局变量在多进程/多线程环境下的并发问题
    """
    return load_sources("rss")


def load_api_sources() -> List[Dict[str, Any]]:
    """
    从配置文件加载API源列表

    Returns:
        API源列表
    """
    return load_sources("api")


def load_web_sources() -> List[Dict[str, Any]]:
    """
    从配置文件加载Web源列表

    Returns:
        Web源列表
    """
    return load_sources("web")


def load_social_sources() -> List[Dict[str, Any]]:
    """
    从配置文件加载社交媒体源列表

    Returns:
        社交媒体源列表
    """
    return load_sources("social")


def load_all_sources() -> List[Dict[str, Any]]:
    """
    从配置文件加载所有类型的源列表

    Returns:
        所有源列表
    """
    all_sources = []
    all_sources.extend(load_rss_sources())
    all_sources.extend(load_api_sources())
    all_sources.extend(load_web_sources())
    all_sources.extend(load_social_sources())
    return all_sources


# 兼容性：保留全局变量但不推荐使用
# 注意：在多进程/多线程环境下，建议直接调用 load_rss_sources() 函数
RSS_SOURCES = load_rss_sources()


