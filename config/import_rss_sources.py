"""
RSS源导入模块
从配置文件加载默认的RSS源列表
"""
import json
from pathlib import Path
from typing import List, Dict, Any

# 获取配置文件路径（当前文件在 config 目录中，sources.json 也在同一目录）
CONFIG_PATH = Path(__file__).parent / "sources.json"


def load_rss_sources() -> List[Dict[str, Any]]:
    """
    从配置文件加载RSS源列表

    Returns:
        RSS源列表，每个源包含 name, url, description, category, tier, language, priority, enabled 等字段

    注意：每次调用都重新读取配置文件，避免全局变量在多进程/多线程环境下的并发问题
    """
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
        
        rss_sources = config.get("rss_sources", [])
        
        # 转换格式，确保所有必需字段都存在
        formatted_sources = []
        for source in rss_sources:
            formatted_source = {
                "name": source.get("name", ""),
                "url": source.get("url", ""),
                "description": source.get("description", ""),
                "category": source.get("category", "other"),
                "tier": source.get("tier", "tier3"),
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
        print(f"❌ 加载RSS源失败: {e}")
        return []


# 兼容性：保留全局变量但不推荐使用
# 注意：在多进程/多线程环境下，建议直接调用 load_rss_sources() 函数
RSS_SOURCES = load_rss_sources()

