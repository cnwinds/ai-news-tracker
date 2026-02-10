#!/usr/bin/env python3
"""
综合评分计算
"""


def calculate_final_score(
    impact_score: float,
    quality_score: float,
    innovation_score: float,
    practicality_score: float,
) -> float:
    score = (
        impact_score * 0.30
        + quality_score * 0.30
        + innovation_score * 0.25
        + practicality_score * 0.15
    )
    return round(max(0.0, min(score, 100.0)), 2)
