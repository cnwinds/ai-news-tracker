"""
工厂函数模块 - 用于创建通用对象实例
"""
from typing import Optional
import logging
from backend.app.core.paths import setup_python_path

# 确保项目根目录在 Python 路径中
setup_python_path()

from backend.app.services.analyzer.ai_analyzer import AIAnalyzer
from backend.app.core.settings import settings

logger = logging.getLogger(__name__)


def create_ai_analyzer(api_key: Optional[str] = None) -> Optional[AIAnalyzer]:
    """
    创建AI分析器实例

    Args:
        api_key: OpenAI API密钥（可选，默认从配置读取）

    Returns:
        AI分析器实例，如果未配置API密钥则返回None
    """
    # 确保配置已加载（强制重新加载以确保使用最新配置）
    settings.load_settings_from_db(force_reload=True)
    
    # 获取提供商配置
    llm_provider_config = settings.get_llm_provider_config()
    embedding_provider_config = settings.get_embedding_provider_config()
    
    # 必须选择提供商
    if not llm_provider_config:
        logger.warning("未选择LLM提供商，无法创建AI分析器")
        return None
    
    llm_api_key = api_key or llm_provider_config["api_key"]
    llm_api_base = llm_provider_config["api_base"]
    # 使用 settings 中已选定的模型（第一个选定的模型）
    llm_model = settings.OPENAI_MODEL
    
    if not llm_api_key:
        return None
    
    # 确定向量模型配置
    if not embedding_provider_config:
        logger.warning("未选择向量模型提供商，无法创建AI分析器")
        return None
    
    embedding_api_key = embedding_provider_config["api_key"]
    embedding_api_base = embedding_provider_config["api_base"]
    # 使用 settings 中已选定的向量模型（第一个选定的模型）
    embedding_model = settings.OPENAI_EMBEDDING_MODEL
    
    # 记录使用的配置（用于调试）
    logger.info(f"创建AI分析器: LLM模型={llm_model}, 向量模型={embedding_model}, "
                f"LLM提供商ID={llm_provider_config['id']}, 向量提供商ID={embedding_provider_config['id']}")
    
    # 如果大模型和向量模型使用不同的提供商，传递独立的配置
    if llm_provider_config["id"] != embedding_provider_config["id"]:
        return AIAnalyzer(
            api_key=llm_api_key,
            base_url=llm_api_base,
            model=llm_model,
            embedding_model=embedding_model,
            embedding_api_key=embedding_api_key,
            embedding_api_base=embedding_api_base,
        )
    else:
        # 使用同一个提供商
        return AIAnalyzer(
            api_key=llm_api_key,
            base_url=llm_api_base,
            model=llm_model,
            embedding_model=embedding_model,
        )
