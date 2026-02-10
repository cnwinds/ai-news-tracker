"""
Agent runtime shared types.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List


@dataclass
class ToolCall:
    """Unified tool call payload from model providers."""

    call_id: str
    name: str
    arguments_json: str


@dataclass
class ModelTurn:
    """Unified model turn output."""

    text: str
    tool_calls: List[ToolCall]


@dataclass
class AgentTool:
    """Tool definition for model-visible tool calling."""

    name: str
    description: str
    input_schema: Dict[str, Any]
    execute: Callable[..., Any]
