#!/usr/bin/env python3
"""
影响力评分计算

改进的评分算法：
1. 为新模型添加基础分（即使没有stars也能获得合理分数）
2. 使用更合理的缩放函数，避免新模型得分过低
3. 综合考虑多个指标
"""
from __future__ import annotations

import math
from typing import Any, Dict


def _log_scaled(value: int) -> float:
    """对数压缩后映射到 0-100"""
    if value <= 0:
        return 0.0
    return min(math.log10(value + 1) * 20, 100.0)


def _linear_scaled(value: int, max_expected: int) -> float:
    """线性缩放到 0-100，适用于小数值"""
    if value <= 0:
        return 0.0
    ratio = min(value / max_expected, 1.0)
    return ratio * 100.0


def calculate_impact_score(model_data: Dict[str, Any]) -> float:
    """
    计算模型的影响力评分

    改进的算法：
    - 对于新模型（stars < 100）：使用线性缩放 + 基础分
    - 对于成熟模型（stars >= 100）：使用对数缩放
    - 添加新模型基础分，确保新发布的模型也能获得合理评分
    """
    stars = int(model_data.get("github_stars") or 0)
    forks = int(model_data.get("github_forks") or 0)
    citations = int(model_data.get("paper_citations") or 0)
    mentions = int(model_data.get("social_mentions") or 0)

    # 新模型基础分：新模型也应该获得基础分数
    new_model_bonus = 40.0  # 新模型基础分40分

    if stars < 100:
        # 新模型：使用线性缩放（对小数值更友好）
        star_score = _linear_scaled(stars, 100) * 0.6 + new_model_bonus * 0.4
        fork_score = _linear_scaled(forks, 50) * 0.6 + new_model_bonus * 0.4
    else:
        # 成熟模型：使用对数缩放
        star_score = _log_scaled(stars) * 0.7 + 30.0  # 添加30分基础分
        fork_score = _log_scaled(forks) * 0.7 + 30.0

    citation_score = _log_scaled(citations) * 0.7 + 30.0 if citations > 0 else 20.0
    mention_score = _log_scaled(mentions) * 0.7 + 30.0 if mentions > 0 else 20.0

    impact = (
        star_score * 0.50  # stars权重提高
        + fork_score * 0.20
        + citation_score * 0.15
        + mention_score * 0.15
    )

    # 确保分数不低于30分（即使是全新模型）
    final_score = max(30.0, min(impact, 100.0))
    return round(final_score, 2)
