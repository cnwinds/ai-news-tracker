"""LLM 主从切换判定测试"""
from backend.app.services.analyzer.ai_analyzer import AIAnalyzer


def test_should_retry_with_fallback_on_safety_message():
    error = Exception("系统检测到输入或生成内容可能包含不安全或敏感内容")
    assert AIAnalyzer.should_retry_with_fallback(error) is True


def test_should_retry_with_fallback_on_503():
    error = Exception("Error code: 503 - Service temporarily unavailable")
    assert AIAnalyzer.should_retry_with_fallback(error) is True


def test_should_not_retry_with_fallback_on_auth_error():
    error = Exception("Error code: 401 - Invalid API key")
    assert AIAnalyzer.should_retry_with_fallback(error) is False
