#!/usr/bin/env python3
"""
List files under a local directory for agent research.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional


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


def list_local_files(
    base_path: str = ".",
    pattern: str = "*",
    recursive: bool = True,
    max_entries: int = 120,
    workspace_root: Optional[str] = None,
) -> Dict[str, Any]:
    base = Path(str(base_path or ".")).resolve()
    root = Path(workspace_root).resolve() if workspace_root else None
    max_entries = _clamp_int(max_entries, minimum=1, maximum=500, default=120)
    glob_pattern = str(pattern or "*").strip() or "*"

    if not base.exists():
        return {"error": f"路径不存在: {base}"}
    if not base.is_dir():
        return {"error": f"路径不是目录: {base}"}

    iterator = base.rglob(glob_pattern) if recursive else base.glob(glob_pattern)
    entries: List[Dict[str, Any]] = []
    truncated = False

    for item in iterator:
        try:
            entry: Dict[str, Any] = {
                "path": _to_relative(item, root),
                "type": "dir" if item.is_dir() else "file",
            }
            if item.is_file():
                entry["size"] = item.stat().st_size
            entries.append(entry)
        except Exception:
            continue

        if len(entries) >= max_entries:
            truncated = True
            break

    return {
        "base_path": _to_relative(base, root),
        "pattern": glob_pattern,
        "recursive": bool(recursive),
        "count": len(entries),
        "truncated": truncated,
        "entries": entries,
    }
