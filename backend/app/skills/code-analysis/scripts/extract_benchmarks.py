#!/usr/bin/env python3
"""
基准信息提取
"""
from __future__ import annotations

from typing import Any, Dict


def extract_benchmarks(model_data: Dict[str, Any]) -> str:
    description = (model_data.get("description") or "").lower()

    benchmark_hints = []
    for keyword in ["mmlu", "gsm8k", "hellaswag", "human-eval", "imagenet", "coco", "wer", "bleu"]:
        if keyword in description:
            benchmark_hints.append(keyword.upper())

    if benchmark_hints:
        hints = ", ".join(benchmark_hints)
        return (
            f"在公开描述中检测到基准关键词: {hints}。\n"
            "建议在深度研究阶段核对仓库中的复现实验脚本和具体评测配置。"
        )

    return (
        "未在公开元信息中检测到明确基准结果。\n"
        "建议补充验证：对照论文/README 中的实验章节，提取任务、指标、对比基线和硬件配置。"
    )
