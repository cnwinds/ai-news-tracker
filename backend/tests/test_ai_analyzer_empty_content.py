"""推理模型正文为空（思考 token 挤占 max_tokens）的处理"""
from types import SimpleNamespace

import httpx
import pytest
from openai import BadRequestError

from backend.app.services.analyzer.ai_analyzer import (
    AIAnalyzer,
    EmptyCompletionError,
    ThinkingNotSupportedError,
)


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


def _analyzer(client, fallback=None, disable_thinking=False):
    analyzer = AIAnalyzer(
        api_key="test",
        base_url="http://localhost/v1",
        model="m",
        disable_thinking=disable_thinking,
    )
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


def test_retries_when_partial_content_is_truncated():
    client = FakeClient([_response("half a sent", "length", 1300), _response("full report")])
    assert _call(_analyzer(client)) == "full report"
    assert [c["max_tokens"] for c in client.calls] == [2000, 16000]


def test_large_budget_truncation_returns_partial_without_retry():
    client = FakeClient([_response("long svg", "length", 100)])
    assert _call(_analyzer(client), max_tokens=32000) == "long svg"
    assert len(client.calls) == 1


def _bad_request(message):
    request = httpx.Request("POST", "http://localhost/v1/chat/completions")
    return BadRequestError(message, response=httpx.Response(400, request=request), body=None)


class RejectingClient(FakeClient):
    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs["max_tokens"] > 8192:
            raise _bad_request("Range of max_tokens should be [1, 8192]")
        return self.responses.pop(0)


def test_provider_output_cap_falls_back_to_safe_budget():
    client = RejectingClient([_response("report")])
    assert _call(_analyzer(client), max_tokens=32000) == "report"
    assert [c["max_tokens"] for c in client.calls] == [32000, 8192]


def test_unrelated_bad_request_is_raised():
    class Broken(FakeClient):
        def _create(self, **kwargs):
            raise _bad_request("invalid model")

    with pytest.raises(BadRequestError):
        _call(_analyzer(Broken([])), max_tokens=32000)


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


def test_disable_thinking_sends_extra_body():
    client = FakeClient([_response("ok")])
    assert _call(_analyzer(client, disable_thinking=True)) == "ok"
    assert client.calls[0]["extra_body"] == {"thinking": {"type": "disabled"}}


def test_disable_thinking_not_sent_when_off():
    client = FakeClient([_response("ok")])
    _call(_analyzer(client, disable_thinking=False))
    assert "extra_body" not in client.calls[0]


def test_forced_thinking_model_raises_clear_error():
    class ForcedThinking(FakeClient):
        def _create(self, **kwargs):
            self.calls.append(kwargs)
            raise _bad_request("thinking.type disabled is not supported for this model")

    with pytest.raises(ThinkingNotSupportedError, match="不支持关闭深度思考"):
        _call(_analyzer(ForcedThinking([]), disable_thinking=True))


def test_unknown_thinking_param_retries_without_extra_body():
    class StrictOpenAI(FakeClient):
        def _create(self, **kwargs):
            self.calls.append(kwargs)
            if "extra_body" in kwargs:
                raise _bad_request("Unknown parameter: 'thinking'")
            return self.responses.pop(0)

    client = StrictOpenAI([_response("ok without thinking")])
    assert _call(_analyzer(client, disable_thinking=True)) == "ok without thinking"
    assert "extra_body" not in client.calls[-1]


def test_thinking_not_supported_switches_to_fallback():
    class ForcedThinking(FakeClient):
        def _create(self, **kwargs):
            self.calls.append(kwargs)
            raise _bad_request("thinking.type disabled is not supported for this model")

    fallback = FakeClient([_response("from fallback")])
    assert _call(_analyzer(ForcedThinking([]), fallback, disable_thinking=True)) == "from fallback"
