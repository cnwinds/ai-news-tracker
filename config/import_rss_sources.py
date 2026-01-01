"""
订阅源导入模块
从配置文件加载默认的订阅源列表（支持rss/api/web/social所有类型）
"""
import json
from pathlib import Path
from typing import List, Dict, Any

# 获取配置文件路径（当前文件在 config 目录中，sources.json 也在同一目录）
CONFIG_PATH = Path(__file__).parent / "sources.json"


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
            formatted_source = {
                "name": source.get("name", ""),
                "url": source.get("url", ""),
                "description": source.get("description", ""),
                "category": source.get("category", "other"),
                "tier": source.get("tier", "tier3"),
                "source_type": source_type,
                "language": source.get("language", "en"),
                "priority": source.get("priority", 3),
                "enabled": source.get("enabled", True),
                "note": source.get("note", ""),
            }
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

