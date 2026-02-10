"""
Protocol-agnostic agent runtime with tool-calling loop.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Sequence

from backend.app.services.exploration.agent.providers import AgentProviderAdapter
from backend.app.services.exploration.agent.types import AgentTool, ToolCall

logger = logging.getLogger(__name__)


class AgentRuntime:
    """Execute an LLM tool-calling loop through provider adapters."""

    def __init__(
        self,
        adapter: AgentProviderAdapter,
        tools: Sequence[AgentTool],
        *,
        max_rounds: int = 8,
        temperature: float = 0.2,
        max_tokens: int = 2500,
    ) -> None:
        self.adapter = adapter
        self.tools = list(tools)
        self.tool_map = {tool.name: tool for tool in self.tools}
        self.max_rounds = max_rounds
        self.temperature = temperature
        self.max_tokens = max_tokens

    def run(self, *, system_prompt: str, user_prompt: str) -> str:
        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        for _ in range(self.max_rounds):
            turn = self.adapter.complete(
                messages,
                self.tools,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )

            assistant_message: Dict[str, Any] = {"role": "assistant", "content": turn.text}
            if turn.tool_calls:
                assistant_message["tool_calls"] = [
                    {
                        "id": call.call_id,
                        "type": "function",
                        "function": {
                            "name": call.name,
                            "arguments": call.arguments_json,
                        },
                    }
                    for call in turn.tool_calls
                ]
            messages.append(assistant_message)

            if not turn.tool_calls:
                return (turn.text or "").strip()

            for tool_call in turn.tool_calls:
                tool_result = self._execute_tool_call(tool_call)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.call_id,
                        "name": tool_call.name,
                        "content": json.dumps(tool_result, ensure_ascii=False),
                    }
                )

        raise RuntimeError("Agent 迭代轮次超限，未收敛到最终回答。")

    def _execute_tool_call(self, tool_call: ToolCall) -> Dict[str, Any]:
        tool = self.tool_map.get(tool_call.name)
        if not tool:
            return {"error": f"未知工具: {tool_call.name}"}

        arguments = self._safe_parse_tool_arguments(tool_call.arguments_json)
        try:
            result = tool.execute(**arguments)
            return self._normalize_tool_result(result)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Agent 工具执行失败 tool=%s error=%s", tool_call.name, exc)
            return {"error": str(exc)}

    @staticmethod
    def _safe_parse_tool_arguments(raw: str) -> Dict[str, Any]:
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}

    @staticmethod
    def _normalize_tool_result(result: Any) -> Dict[str, Any]:
        if isinstance(result, dict):
            return result
        if isinstance(result, list):
            return {"items": result}
        return {"result": result}
