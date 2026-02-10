#!/usr/bin/env python3
"""
Read local file content for agent research.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional


def _clamp_int(value: Any, minimum: int, maximum: int, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def _to_relative(path: Path, workspace_root: Optional[Path]) -> str:
    if workspace_root is None:
        return str(path)
    try:
        return str(path.relative_to(workspace_root))
    except Exception:
        return str(path)


def read_local_file(
    path: str,
    start_line: int = 1,
    end_line: Optional[int] = None,
    max_chars: int = 12000,
    workspace_root: Optional[str] = None,
) -> Dict[str, Any]:
    target = Path(str(path or "")).resolve()
    root = Path(workspace_root).resolve() if workspace_root else None
    max_chars = _clamp_int(max_chars, minimum=500, maximum=50000, default=12000)

    if not target.exists():
        return {"error": f"文件不存在: {target}"}
    if not target.is_file():
        return {"error": f"目标不是文件: {target}"}

    raw = target.read_text(encoding="utf-8", errors="replace")
    lines = raw.splitlines()
    total_lines = len(lines)

    line_start = _clamp_int(start_line, minimum=1, maximum=max(1, total_lines), default=1)
    if end_line is None:
        line_end = total_lines
    else:
        line_end = _clamp_int(end_line, minimum=line_start, maximum=total_lines, default=total_lines)

    snippet = "\n".join(lines[line_start - 1 : line_end]) if total_lines > 0 else ""
    truncated = False
    if len(snippet) > max_chars:
        snippet = snippet[:max_chars]
        truncated = True

    return {
        "path": _to_relative(target, root),
        "line_start": line_start,
        "line_end": line_end,
        "total_lines": total_lines,
        "content": snippet,
        "truncated": truncated,
        "content_length": len(snippet),
    }
