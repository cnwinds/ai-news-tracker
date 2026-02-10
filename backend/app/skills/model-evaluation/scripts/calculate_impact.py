#!/usr/bin/env python3
"""
影响力评分计算
"""
from __future__ import annotations

import math
from typing import Any, Dict


def _log_scaled(value: int) -> float:
    # 对数压缩后映射到 0-100
    return min(math.log10(max(value, 0) + 1) * 25, 100.0)


def calculate_impact_score(model_data: Dict[str, Any]) -> float:
    stars = int(model_data.get("github_stars") or 0)
    forks = int(model_data.get("github_forks") or 0)
    citations = int(model_data.get("paper_citations") or 0)
    mentions = int(model_data.get("social_mentions") or 0)

    star_score = _log_scaled(stars)
    fork_score = _log_scaled(forks)
    citation_score = _log_scaled(citations)
    mention_score = _log_scaled(mentions)

    impact = (
        star_score * 0.40
        + fork_score * 0.20
        + citation_score * 0.20
        + mention_score * 0.20
    )
    return round(max(0.0, min(impact, 100.0)), 2)
