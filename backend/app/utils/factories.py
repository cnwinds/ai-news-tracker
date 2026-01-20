"""
工厂函数模块 - 用于创建通用对象实例
"""
import logging
from typing import Dict, Optional

from backend.app.core.settings import settings
from backend.app.services.analyzer.ai_analyzer import AIAnalyzer

logger = logging.getLogger(__name__)


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


def create_ai_analyzer(api_key: Optional[str] = None) -> Optional[AIAnalyzer]:
    """创建AI分析器实例

    Args:
        api_key: OpenAI API密钥（可选，默认从配置读取）

    Returns:
        AI分析器实例，如果未配置API密钥则返回None
    """
    settings.load_settings_from_db(force_reload=True)
    
    llm_provider_config = settings.get_llm_provider_config()
    embedding_provider_config = settings.get_embedding_provider_config()
    
    if not _validate_provider_config(llm_provider_config, "LLM"):
        return None
    
    llm_api_key = api_key or llm_provider_config["api_key"]
    if not llm_api_key:
        return None
    
    if not _validate_provider_config(embedding_provider_config, "向量模型"):
        return None
    
    llm_model = settings.OPENAI_MODEL
    embedding_model = settings.OPENAI_EMBEDDING_MODEL
    
    logger.info(
        f"创建AI分析器: LLM模型={llm_model}, 向量模型={embedding_model}, "
        f"LLM提供商ID={llm_provider_config['id']}, "
        f"向量提供商ID={embedding_provider_config['id']}"
    )
    
    if llm_provider_config["id"] != embedding_provider_config["id"]:
        return _create_analyzer_with_separate_providers(
            llm_provider_config,
            embedding_provider_config,
            llm_api_key,
            llm_model,
            embedding_model
        )
    
    return _create_analyzer_with_same_provider(
        llm_provider_config,
        llm_api_key,
        llm_model,
        embedding_model
    )
