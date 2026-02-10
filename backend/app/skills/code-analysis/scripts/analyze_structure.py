#!/usr/bin/env python3
"""
代码结构分析
"""
from __future__ import annotations

from typing import Any, Dict


def analyze_structure(model_data: Dict[str, Any]) -> str:
    github_url = model_data.get("github_url")
    description = (model_data.get("description") or "").strip()
    stars = int(model_data.get("github_stars") or 0)
    forks = int(model_data.get("github_forks") or 0)

    if not github_url:
        return (
            "该模型未公开主要代码仓库，无法执行仓库级静态结构分析。"
            "建议重点关注论文附录与模型卡中的实现细节。"
        )

    maturity = "早期探索"
    if stars >= 1000:
        maturity = "社区成熟"
    elif stars >= 200:
        maturity = "快速增长"

    return (
        f"- 仓库地址: {github_url}\n"
        f"- 社区信号: Stars={stars}, Forks={forks}\n"
        f"- 结构成熟度判断: {maturity}\n"
        f"- 项目描述完整度: {'较好' if len(description) >= 80 else '一般'}"
    )
