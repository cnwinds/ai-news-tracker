"""
LLM provider adapters for unified agent runtime.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Sequence, Tuple

from openai import OpenAI

from backend.app.services.exploration.agent.types import AgentTool, ModelTurn, ToolCall

logger = logging.getLogger(__name__)


class AgentProviderAdapter:
    """Base adapter interface."""

    def complete(
        self,
        messages: Sequence[Dict[str, Any]],
        tools: Sequence[AgentTool],
        *,
        temperature: float = 0.2,
        max_tokens: int = 2500,
    ) -> ModelTurn:
        raise NotImplementedError


class OpenAICompatAdapter(AgentProviderAdapter):
    """Adapter for OpenAI-compatible chat-completions APIs."""

    def __init__(self, api_key: str, model: str, base_url: Optional[str] = None):
        client_kwargs: Dict[str, Any] = {
            "api_key": api_key,
            "timeout": 90.0,
            "max_retries": 2,
        }
        if base_url:
            client_kwargs["base_url"] = base_url
        self.client = OpenAI(**client_kwargs)
        self.model = model

    def complete(
        self,
        messages: Sequence[Dict[str, Any]],
        tools: Sequence[AgentTool],
        *,
        temperature: float = 0.2,
        max_tokens: int = 2500,
    ) -> ModelTurn:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=list(messages),
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema,
                    },
                }
                for tool in tools
            ]
            if tools
            else None,
            tool_choice="auto" if tools else None,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        message = response.choices[0].message
        text = message.content or ""
        calls: List[ToolCall] = []
        for call in message.tool_calls or []:
            arguments_json = call.function.arguments or "{}"
            calls.append(
                ToolCall(
                    call_id=call.id,
                    name=call.function.name,
                    arguments_json=arguments_json,
                )
            )
        return ModelTurn(text=text, tool_calls=calls)


class AnthropicAdapter(AgentProviderAdapter):
    """Adapter for Anthropic messages API."""

    def __init__(self, api_key: str, model: str, base_url: Optional[str] = None):
        try:
            from anthropic import Anthropic  # type: ignore
            import httpx
        except ImportError as exc:  # pragma: no cover - depends on optional package
            raise RuntimeError(
                "当前环境未安装 anthropic SDK，请先安装 anthropic 依赖。"
            ) from exc

        # 兼容 anthropic<0.39 与 httpx>=0.28 的组合：
        # 老版本 anthropic 默认会向 httpx.Client 透传 proxies 参数，
        # 在 httpx 0.28+ 中会触发 TypeError: unexpected keyword argument 'proxies'。
        client_kwargs: Dict[str, Any] = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url
        client_kwargs["http_client"] = httpx.Client(timeout=httpx.Timeout(90.0))

        self.client = Anthropic(**client_kwargs)
        self.model = model
        self._fallback_api_key = api_key
        self._fallback_model = model
        self._fallback_base_url = base_url
        self._fallback_adapter: Optional[OpenAICompatAdapter] = None

    def complete(
        self,
        messages: Sequence[Dict[str, Any]],
        tools: Sequence[AgentTool],
        *,
        temperature: float = 0.2,
        max_tokens: int = 2500,
    ) -> ModelTurn:
        system_prompt, anthropic_messages = self._to_anthropic_messages(messages)
        request_kwargs: Dict[str, Any] = {
            "model": self.model,
            "messages": anthropic_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if system_prompt:
            request_kwargs["system"] = system_prompt
        if tools:
            request_kwargs["tools"] = [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema,
                }
                for tool in tools
            ]

        try:
            response = self.client.messages.create(**request_kwargs)
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            if self._should_fallback_to_openai(message):
                logger.warning(
                    "Anthropic 协议调用失败，回退 OpenAI 兼容协议: %s",
                    message,
                )
                return self._complete_with_openai_fallback(
                    messages=messages,
                    tools=tools,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    original_error=message,
                )
            raise

        text_chunks: List[str] = []
        calls: List[ToolCall] = []
        for block in response.content:
            block_type = getattr(block, "type", None)
            if block_type == "text":
                text_chunks.append(getattr(block, "text", ""))
            elif block_type == "tool_use":
                calls.append(
                    ToolCall(
                        call_id=getattr(block, "id", ""),
                        name=getattr(block, "name", ""),
                        arguments_json=json.dumps(getattr(block, "input", {}) or {}, ensure_ascii=False),
                    )
                )

        return ModelTurn(text="".join(text_chunks).strip(), tool_calls=calls)

    def _to_anthropic_messages(
        self, messages: Sequence[Dict[str, Any]]
    ) -> Tuple[str, List[Dict[str, Any]]]:
        system_parts: List[str] = []
        converted: List[Dict[str, Any]] = []

        for message in messages:
            role = message.get("role")
            if role == "system":
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    system_parts.append(content.strip())
                continue

            if role == "user":
                converted.append(
                    {
                        "role": "user",
                        "content": message.get("content", ""),
                    }
                )
                continue

            if role == "assistant":
                blocks: List[Dict[str, Any]] = []
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    blocks.append({"type": "text", "text": content})
                for call in message.get("tool_calls") or []:
                    function_obj = call.get("function") or {}
                    blocks.append(
                        {
                            "type": "tool_use",
                            "id": call.get("id"),
                            "name": function_obj.get("name", ""),
                            "input": self._safe_json_loads(function_obj.get("arguments", "{}")),
                        }
                    )
                converted.append({"role": "assistant", "content": blocks or [{"type": "text", "text": ""}]})
                continue

            if role == "tool":
                tool_result_block = {
                    "type": "tool_result",
                    "tool_use_id": message.get("tool_call_id"),
                    "content": message.get("content", ""),
                }
                if (
                    converted
                    and converted[-1].get("role") == "user"
                    and isinstance(converted[-1].get("content"), list)
                ):
                    converted[-1]["content"].append(tool_result_block)
                else:
                    converted.append({"role": "user", "content": [tool_result_block]})

        return "\n\n".join(system_parts), converted

    @staticmethod
    def _safe_json_loads(raw: Any) -> Dict[str, Any]:
        if isinstance(raw, dict):
            return raw
        if not isinstance(raw, str):
            return {}
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}

    @staticmethod
    def _should_fallback_to_openai(error_message: str) -> bool:
        text = (error_message or "").lower()
        fallback_signals = (
            "invalid x-api-key",
            "authentication_error",
            "unexpected keyword argument 'proxies'",
            "404",
            "not found",
            "unsupported",
            "messages.create",
        )
        return any(signal in text for signal in fallback_signals)

    def _complete_with_openai_fallback(
        self,
        *,
        messages: Sequence[Dict[str, Any]],
        tools: Sequence[AgentTool],
        temperature: float,
        max_tokens: int,
        original_error: str,
    ) -> ModelTurn:
        if self._fallback_adapter is None:
            try:
                self._fallback_adapter = OpenAICompatAdapter(
                    api_key=self._fallback_api_key,
                    model=self._fallback_model,
                    base_url=self._fallback_base_url,
                )
            except Exception as exc:  # noqa: BLE001
                raise RuntimeError(
                    "Anthropic 协议失败且 OpenAI 兼容回退初始化失败: "
                    f"anthropic_error={original_error}; openai_fallback_error={exc}"
                ) from exc
        return self._fallback_adapter.complete(
            messages=messages,
            tools=tools,
            temperature=temperature,
            max_tokens=max_tokens,
        )


def build_provider_adapter(
    *,
    provider_type: str,
    api_key: str,
    model: str,
    api_base: Optional[str] = None,
) -> AgentProviderAdapter:
    normalized = (provider_type or "").strip().lower()
    if "anthropic" in normalized or "claude" in normalized:
        return AnthropicAdapter(api_key=api_key, model=model, base_url=api_base)
    return OpenAICompatAdapter(api_key=api_key, model=model, base_url=api_base)
