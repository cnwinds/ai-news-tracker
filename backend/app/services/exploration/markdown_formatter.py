"""
Exploration report markdown formatting helpers.
"""
from __future__ import annotations

import ast
import json
import re
from typing import Any, List, Optional


def to_markdown_text(value: Any) -> str:
    """
    Convert arbitrary section payloads to markdown-friendly text.

    Supports:
    - plain markdown strings
    - JSON strings
    - Python-literal strings (e.g. "{'a': 1, 'b': ['x']}")
    - dict/list/tuple objects
    """
    if value is None:
        return ""

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return ""
        parsed = _try_parse_structured_text(text)
        if parsed is None:
            return text
        return _to_markdown_from_object(parsed).strip()

    return _to_markdown_from_object(value).strip()


def looks_like_markdown(text: str) -> bool:
    normalized = (text or "").strip()
    if not normalized:
        return False
    markdown_signals = ("# ", "## ", "### ", "- ", "* ", "1. ", "|", "```", "> ")
    return any(signal in normalized for signal in markdown_signals)


def normalize_bullet_item(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    # Trim leading markdown bullets / numbered prefixes.
    text = re.sub(r"^\s*(?:[-*+]\s+|\d+\.\s+)", "", text)
    return text.strip()


def _try_parse_structured_text(text: str) -> Optional[Any]:
    looks_structured = (
        (text.startswith("{") and text.endswith("}"))
        or (text.startswith("[") and text.endswith("]"))
        or (text.startswith("(") and text.endswith(")"))
    )
    if not looks_structured:
        return None

    try:
        return json.loads(text)
    except Exception:
        pass

    try:
        parsed = ast.literal_eval(text)
        if isinstance(parsed, (dict, list, tuple)):
            return parsed
    except Exception:
        return None

    return None


def _to_markdown_from_object(value: Any) -> str:
    lines = _to_markdown_lines(value, indent=0)
    return "\n".join(lines) if lines else str(value).strip()


def _to_markdown_lines(value: Any, indent: int) -> List[str]:
    prefix = "  " * indent

    if isinstance(value, dict):
        lines: List[str] = []
        for key, item in value.items():
            label = str(key).strip() or "字段"
            if isinstance(item, (dict, list, tuple)):
                lines.append(f"{prefix}- **{label}**:")
                child_lines = _to_markdown_lines(item, indent + 1)
                if child_lines:
                    lines.extend(child_lines)
                else:
                    lines.append(f"{prefix}  - 暂无")
            else:
                text = str(item).strip()
                lines.append(f"{prefix}- **{label}**: {text or '暂无'}")
        return lines

    if isinstance(value, (list, tuple)):
        lines = []
        for item in value:
            if isinstance(item, (dict, list, tuple)):
                lines.append(f"{prefix}-")
                child_lines = _to_markdown_lines(item, indent + 1)
                if child_lines:
                    lines.extend(child_lines)
            else:
                text = str(item).strip()
                lines.append(f"{prefix}- {text or '暂无'}")
        return lines

    text = str(value).strip()
    return [f"{prefix}{text}"] if text else []
