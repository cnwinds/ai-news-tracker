#!/usr/bin/env python3
"""
Hugging Face 平台模型先知发现脚本。
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence


def discover_huggingface(
    keywords: Optional[List[str]] = None,
    days_back: int = 7,
    max_results: int = 50,
    watch_organizations: Optional[List[str]] = None,
) -> List[Dict]:
    try:
        from huggingface_hub import HfApi
    except ImportError:
        return []

    api = HfApi(token=os.getenv("HUGGINGFACE_TOKEN"))
    cutoff = datetime.utcnow() - timedelta(days=days_back)
    watch_set = {item.strip().lower() for item in (watch_organizations or []) if item and item.strip()}

    if keywords is None:
        keywords = ["llm", "multimodal", "reasoning", "foundation model"]

    limit = min(max(80, max_results * 5), 600)

    results: List[Dict] = []
    try:
        models = api.list_models(
            sort="lastModified",
            direction=-1,
            limit=limit,
            full=True,
            cardData=True,
            fetch_config=False,
        )
    except Exception:
        return []

    for model in models:
        model_id = str(getattr(model, "modelId", "") or "").strip()
        if not model_id:
            continue

        owner = model_id.split("/")[0] if "/" in model_id else "unknown"
        owner_lower = owner.lower()
        watch_hit = owner_lower in watch_set

        last_modified = _to_datetime(getattr(model, "lastModified", None))
        created_at = _to_datetime(getattr(model, "createdAt", None))

        if last_modified and last_modified < cutoff and not watch_hit:
            continue

        pipeline_tag = str(getattr(model, "pipeline_tag", "") or "").strip().lower()
        card_data = getattr(model, "cardData", None) or {}

        description = _build_description(model_id=model_id, pipeline_tag=pipeline_tag, card_data=card_data)
        if not watch_hit and not _keyword_match(model_id=model_id, description=description, keywords=keywords):
            continue

        likes = int(getattr(model, "likes", 0) or 0)
        downloads = int(getattr(model, "downloads", 0) or 0)
        update_type = _infer_update_type(created_at=created_at, last_modified=last_modified)
        signal_reasons = _build_signal_reasons(
            update_type=update_type,
            likes=likes,
            downloads=downloads,
            watch_hit=watch_hit,
            last_modified=last_modified,
        )
        release_confidence = _estimate_release_confidence(
            update_type=update_type,
            likes=likes,
            downloads=downloads,
            watch_hit=watch_hit,
            pipeline_tag=pipeline_tag,
        )

        model_info: Dict = {
            "model_name": model_id.split("/")[-1],
            "source_platform": "huggingface",
            "source_uid": model_id.lower(),
            "url": f"https://huggingface.co/{model_id}",
            "model_url": f"https://huggingface.co/{model_id}",
            "organization": owner,
            "release_date": (created_at or last_modified).isoformat() if (created_at or last_modified) else None,
            "last_updated": last_modified.isoformat() if last_modified else None,
            "model_type": _identify_model_type(pipeline_tag=pipeline_tag, tags=getattr(model, "tags", None)),
            "description": description,
            "github_stars": likes,
            "github_forks": 0,
            "social_mentions": downloads,
            "license": _extract_license(card_data=card_data),
            "update_type": update_type,
            "update_summary": _build_update_summary(model_id=model_id, update_type=update_type),
            "signal_reasons": signal_reasons,
            "signal_score": round(min(100.0, release_confidence * 0.9), 2),
            "release_confidence": round(release_confidence, 2),
            "watch_hit": watch_hit,
            "discovered_at": datetime.utcnow().isoformat(),
        }

        results.append(model_info)
        if len(results) >= max_results:
            break

    results.sort(
        key=lambda item: (
            float(item.get("release_confidence", 0.0)),
            int(item.get("github_stars", 0)),
            int(item.get("social_mentions", 0)),
        ),
        reverse=True,
    )
    return results[:max_results]


def _to_datetime(value: object) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).replace(tzinfo=None)
    except ValueError:
        return None


def _build_description(model_id: str, pipeline_tag: str, card_data: Dict) -> str:
    summary = card_data.get("summary") or card_data.get("description") or ""
    summary_text = str(summary).strip()
    if summary_text:
        return summary_text[:300]
    if pipeline_tag:
        return f"Hugging Face 模型 {model_id}，pipeline={pipeline_tag}"
    return f"Hugging Face 模型 {model_id}"


def _keyword_match(model_id: str, description: str, keywords: Sequence[str]) -> bool:
    text = f"{model_id} {description}".lower()
    return any(str(keyword).lower() in text for keyword in keywords)


def _identify_model_type(pipeline_tag: str, tags: Optional[Sequence[str]]) -> str:
    text = f"{pipeline_tag} {' '.join(tags or [])}".lower()
    if any(token in text for token in ["text-generation", "causal-lm", "llm", "chat"]):
        return "LLM"
    if any(token in text for token in ["vision", "image", "object-detection"]):
        return "Vision"
    if any(token in text for token in ["speech", "audio", "asr", "tts"]):
        return "Audio"
    if any(token in text for token in ["multimodal", "vlm", "image-to-text"]):
        return "Multimodal"
    if any(token in text for token in ["diffusion", "text-to-image", "image-generation"]):
        return "Generative"
    return "Other"


def _extract_license(card_data: Dict) -> str:
    license_value = card_data.get("license")
    if not license_value:
        return "Unknown"
    return str(license_value).strip() or "Unknown"


def _infer_update_type(created_at: Optional[datetime], last_modified: Optional[datetime]) -> str:
    if created_at and last_modified:
        if (last_modified - created_at).total_seconds() <= 48 * 3600:
            return "new_model_card"
    return "weights_update"


def _build_signal_reasons(
    update_type: str,
    likes: int,
    downloads: int,
    watch_hit: bool,
    last_modified: Optional[datetime],
) -> List[str]:
    reasons = [f"update_type={update_type}", f"likes={likes}", f"downloads={downloads}"]
    if watch_hit:
        reasons.append("watch_organization_hit=true")
    if last_modified:
        reasons.append(f"last_modified={last_modified.isoformat()}")
    return reasons


def _estimate_release_confidence(
    update_type: str,
    likes: int,
    downloads: int,
    watch_hit: bool,
    pipeline_tag: str,
) -> float:
    base = 76.0 if update_type == "new_model_card" else 68.0

    if likes >= 1000:
        base += 8
    elif likes >= 300:
        base += 5
    elif likes >= 100:
        base += 3

    if downloads >= 500000:
        base += 6
    elif downloads >= 100000:
        base += 4
    elif downloads >= 20000:
        base += 2

    if pipeline_tag in {"text-generation", "image-text-to-text"}:
        base += 2

    if watch_hit:
        base += 6

    return max(0.0, min(99.0, base))


def _build_update_summary(model_id: str, update_type: str) -> str:
    if update_type == "new_model_card":
        return f"Hugging Face 检测到新模型条目：{model_id}"
    return f"Hugging Face 检测到模型权重/配置更新：{model_id}"


if __name__ == "__main__":
    import json

    payload = discover_huggingface(
        days_back=7,
        max_results=20,
        watch_organizations=["openai", "mistralai", "qwen", "deepseek-ai"],
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
