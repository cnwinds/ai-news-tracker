"""
工厂函数模块 - 用于创建通用对象实例
"""
from typing import Optional
from analyzer.ai_analyzer import AIAnalyzer
from config.settings import settings


def create_ai_analyzer(api_key: Optional[str] = None) -> Optional[AIAnalyzer]:
    """
    创建AI分析器实例

    Args:
        api_key: OpenAI API密钥（可选，默认从配置读取）

    Returns:
        AI分析器实例，如果未配置API密钥则返回None
    """
    key = api_key or settings.OPENAI_API_KEY
    if not key:
        return None

    return AIAnalyzer(
        api_key=key,
        base_url=settings.OPENAI_API_BASE,
        model=settings.OPENAI_MODEL,
    )
