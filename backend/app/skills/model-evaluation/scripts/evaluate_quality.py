#!/usr/bin/env python3
"""
质量、创新性、实用性评分
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict


def _clamp(score: float) -> float:
    return round(max(0.0, min(score, 100.0)), 2)


def _score_quality(model_data: Dict[str, Any]) -> float:
    description = (model_data.get("description") or "").strip()
    has_github = bool(model_data.get("github_url"))
    has_paper = bool(model_data.get("paper_url"))
    license_name = (model_data.get("license") or "unknown").lower()
    stars = int(model_data.get("github_stars") or 0)
    forks = int(model_data.get("github_forks") or 0)

    code_quality = 35.0
    if has_github:
        code_quality += 15.0
    code_quality += min(stars / 80.0, 30.0)

    docs = 25.0 + min(len(description) / 8.0, 40.0)
    if has_paper:
        docs += 10.0

    activity = 40.0 + min(forks / 50.0, 40.0)
    if model_data.get("release_date"):
        activity += 5.0

    community = 20.0 + min((stars + forks) / 120.0, 70.0)
    if license_name not in {"unknown", ""}:
        community += 5.0

    return _clamp(code_quality * 0.40 + docs * 0.30 + activity * 0.20 + community * 0.10)


def _score_innovation(model_data: Dict[str, Any]) -> float:
    text = f"{model_data.get('model_name', '')} {model_data.get('description', '')}".lower()

    breakthrough_keywords = [
        "novel",
        "state-of-the-art",
        "sota",
        "new architecture",
        "breakthrough",
    ]
    performance_keywords = ["improve", "faster", "better", "efficient", "benchmark"]
    novelty_keywords = ["first", "new", "next-gen", "hybrid", "agentic"]

    technical_breakthrough = 45.0 + 10.0 * sum(1 for k in breakthrough_keywords if k in text)
    performance_gain = 40.0 + 8.0 * sum(1 for k in performance_keywords if k in text)
    novelty = 40.0 + 7.0 * sum(1 for k in novelty_keywords if k in text)

    return _clamp(technical_breakthrough * 0.50 + performance_gain * 0.30 + novelty * 0.20)


def _score_practicality(model_data: Dict[str, Any]) -> float:
    model_type = (model_data.get("model_type") or "other").lower()
    has_model_url = bool(model_data.get("model_url"))
    has_github = bool(model_data.get("github_url"))
    license_name = (model_data.get("license") or "unknown").lower()

    scenario = 55.0
    if model_type in {"llm", "vision", "multimodal", "audio", "generative"}:
        scenario += 20.0

    usability = 40.0 + (20.0 if has_model_url else 0.0) + (15.0 if has_github else 0.0)
    resource = 60.0

    commercial_friendly = {"mit", "apache-2.0", "bsd-3-clause", "bsd-2-clause"}
    license_score = 90.0 if license_name in commercial_friendly else 55.0
    if license_name in {"unknown", ""}:
        license_score = 45.0

    return _clamp(scenario * 0.40 + usability * 0.30 + resource * 0.20 + license_score * 0.10)


def evaluate_quality_scores(model_data: Dict[str, Any]) -> Dict[str, float]:
    quality = _score_quality(model_data)
    innovation = _score_innovation(model_data)
    practicality = _score_practicality(model_data)

    return {
        "quality_score": quality,
        "innovation_score": innovation,
        "practicality_score": practicality,
        "evaluated_at": datetime.now().isoformat(),
    }
