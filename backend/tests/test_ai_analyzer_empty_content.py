"""推理模型正文为空（思考 token 挤占 max_tokens）的处理"""
from types import SimpleNamespace

import pytest

from backend.app.services.analyzer.ai_analyzer import AIAnalyzer, EmptyCompletionError


def _response(content, finish_reason="stop", reasoning_tokens=0):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content), finish_reason=finish_reason)],
        usage=SimpleNamespace(completion_tokens_details=SimpleNamespace(reasoning_tokens=reasoning_tokens)),
    )


class FakeClient:
    def __init__(self, responses, timeout=60.0):
        self.responses = list(responses)
        self.calls = []
        self.timeout = timeout
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)

    def with_options(self, **kwargs):
        self.timeout = kwargs.get("timeout", self.timeout)
        return self


def _analyzer(client, fallback=None):
    analyzer = AIAnalyzer(api_key="test", base_url="http://localhost/v1", model="m")
    analyzer.client = client
    if fallback is not None:
        analyzer.fallback_client = fallback
        analyzer.fallback_model = "fb"
    return analyzer


def _call(analyzer, max_tokens=2000):
    return analyzer._chat_completion_text(
        [{"role": "user", "content": "hi"}], max_tokens=max_tokens, purpose="test"
    )


def test_returns_content():
    client = FakeClient([_response(" ok ")])
    assert _call(_analyzer(client)) == "ok"
    assert len(client.calls) == 1


def test_retries_with_larger_budget_when_reasoning_exhausts_tokens():
    client = FakeClient([_response("", "length", 2000), _response("report")])
    assert _call(_analyzer(client)) == "report"
    assert [c["max_tokens"] for c in client.calls] == [2000, 16000]
    assert client.timeout >= 600


def test_empty_content_raises_instead_of_returning_blank():
    client = FakeClient([_response("", "length", 2000), _response("", "length", 16000)])
    with pytest.raises(EmptyCompletionError):
        _call(_analyzer(client))


def test_empty_stop_content_does_not_retry_same_model():
    client = FakeClient([_response("   ", "stop")])
    with pytest.raises(EmptyCompletionError):
        _call(_analyzer(client))
    assert len(client.calls) == 1


def test_empty_content_switches_to_fallback_model():
    primary = FakeClient([_response(None, "stop")])
    fallback = FakeClient([_response("from fallback")])
    assert _call(_analyzer(primary, fallback)) == "from fallback"
    assert fallback.calls[0]["model"] == "fb"
