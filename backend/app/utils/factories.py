"""
工厂函数模块 - 用于创建通用对象实例
"""
import logging
import threading
from typing import Dict, Optional, Tuple

from backend.app.core.settings import settings
from backend.app.services.analyzer.ai_analyzer import AIAnalyzer

logger = logging.getLogger(__name__)

_ANALYZER_LOCK = threading.Lock()
_CACHED_ANALYZER: Optional[AIAnalyzer] = None
_CACHED_KEY: Optional[Tuple] = None


def _validate_provider_config(config: Optional[Dict], provider_type: str) -> bool:
    """验证提供商配置是否有效
    
    Args:
        config: 提供商配置字典
        provider_type: 提供商类型（用于日志）
        
    Returns:
        配置是否有效
    """
    if not config:
        logger.warning(f"未选择{provider_type}提供商，无法创建AI分析器")
        return False
    return True


def _create_analyzer_with_separate_providers(
    llm_config: Dict,
    embedding_config: Dict,
    llm_api_key: str,
    llm_model: str,
    embedding_model: str
) -> AIAnalyzer:
    """创建使用不同提供商的AI分析器
    
    Args:
        llm_config: LLM提供商配置
        embedding_config: 向量模型提供商配置
        llm_api_key: LLM API密钥
        llm_model: LLM模型名称
        embedding_model: 向量模型名称
        
    Returns:
        AI分析器实例
    """
    return AIAnalyzer(
        api_key=llm_api_key,
        base_url=llm_config["api_base"],
        model=llm_model,
        embedding_model=embedding_model,
        embedding_api_key=embedding_config["api_key"],
        embedding_api_base=embedding_config["api_base"],
    )


def _create_analyzer_with_same_provider(
    provider_config: Dict,
    api_key: str,
    llm_model: str,
    embedding_model: str
) -> AIAnalyzer:
    """创建使用同一提供商的AI分析器
    
    Args:
        provider_config: 提供商配置
        api_key: API密钥
        llm_model: LLM模型名称
        embedding_model: 向量模型名称
        
    Returns:
        AI分析器实例
    """
    return AIAnalyzer(
        api_key=api_key,
        base_url=provider_config["api_base"],
        model=llm_model,
        embedding_model=embedding_model,
    )


def _analyzer_cache_key(
    llm_config: Dict,
    embedding_config: Dict,
    llm_api_key: str,
) -> Tuple:
    return (
        llm_config.get("id"),
        llm_config.get("selected_model"),
        llm_config.get("api_base"),
        embedding_config.get("id"),
        embedding_config.get("selected_model"),
        embedding_config.get("api_base"),
        (llm_api_key or "")[-6:],
        (embedding_config.get("api_key") or "")[-6:],
    )


def invalidate_ai_analyzer_cache() -> None:
    """设置变更后丢弃进程内 AI 客户端和 query embedding 缓存。"""
    global _CACHED_ANALYZER, _CACHED_KEY
    with _ANALYZER_LOCK:
        _CACHED_ANALYZER = None
        _CACHED_KEY = None
    try:
        from backend.app.services.rag.query_cache import query_embedding_cache
        query_embedding_cache.clear()
    except Exception:
        pass
    logger.info("AI analyzer cache invalidated")


def create_ai_analyzer(
    api_key: Optional[str] = None,
    force_new: bool = False,
) -> Optional[AIAnalyzer]:
    """创建或复用 AI 分析器。

    默认复用进程内客户端，不再每次 force_reload 配置。
    设置页保存 LLM/提供商后应调用 invalidate_ai_analyzer_cache()。
    """
    global _CACHED_ANALYZER, _CACHED_KEY

    settings.load_settings_from_db(force_reload=force_new)
    
    llm_provider_config = settings.get_llm_provider_config()
    embedding_provider_config = settings.get_embedding_provider_config()
    
    if not _validate_provider_config(llm_provider_config, "LLM"):
        return None
    
    llm_api_key = api_key or llm_provider_config["api_key"]
    if not llm_api_key:
        return None
    
    if not _validate_provider_config(embedding_provider_config, "向量模型"):
        return None
    
    llm_model = llm_provider_config["selected_model"]
    embedding_model = embedding_provider_config["selected_model"]
    cache_key = _analyzer_cache_key(
        llm_provider_config, embedding_provider_config, llm_api_key
    )

    with _ANALYZER_LOCK:
        if (
            not force_new
            and _CACHED_ANALYZER is not None
            and _CACHED_KEY == cache_key
        ):
            return _CACHED_ANALYZER
    
    logger.info(
        f"创建AI分析器: LLM模型={llm_model}, 向量模型={embedding_model}, "
        f"LLM提供商ID={llm_provider_config['id']}, "
        f"向量提供商ID={embedding_provider_config['id']}"
    )
    
    if llm_provider_config["id"] != embedding_provider_config["id"]:
        analyzer = _create_analyzer_with_separate_providers(
            llm_provider_config,
            embedding_provider_config,
            llm_api_key,
            llm_model,
            embedding_model
        )
    else:
        analyzer = _create_analyzer_with_same_provider(
            llm_provider_config,
            llm_api_key,
            llm_model,
            embedding_model
        )

    with _ANALYZER_LOCK:
        _CACHED_ANALYZER = analyzer
        _CACHED_KEY = cache_key
    return analyzer
