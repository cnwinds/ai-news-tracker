#!/usr/bin/env python3
"""
ModelScope 平台模型先知发现脚本。
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence


DEFAULT_WATCH_ORGS = [
    "Qwen",
    "deepseek-ai",
    "ZhipuAI",
    "THUDM",
    "internlm",
    "baichuan-inc",
    "01-ai",
]


def discover_modelscope(
    keywords: Optional[List[str]] = None,
    days_back: int = 7,
    max_results: int = 50,
    watch_organizations: Optional[List[str]] = None,
) -> List[Dict]:
    try:
        from modelscope.hub.api import HubApi
    except ImportError:
        return []

    if keywords is None:
        keywords = ["llm", "chat", "reasoning", "multimodal", "foundation model"]

    cutoff = datetime.utcnow() - timedelta(days=days_back)
    watch_targets = [item.strip() for item in (watch_organizations or DEFAULT_WATCH_ORGS) if item and item.strip()]
    watch_set = {item.lower() for item in watch_targets}

    api = HubApi()
    collected: List[Dict[str, Any]] = []

    for owner in watch_targets:
        items = _list_models_for_owner(api=api, owner=owner, page_size=min(100, max_results * 2), max_pages=3)
        collected.extend(items)

    seen: Dict[str, Dict] = {}
    for raw in collected:
        model_id = str(_pick(raw, ["Path", "path", "ModelId", "model_id", "Id", "id"], "")).strip()
        if not model_id:
            continue

        owner = model_id.split("/")[0] if "/" in model_id else str(
            _pick(raw, ["Owner", "owner", "organization", "Organization"], "Unknown")
        )
        owner = owner.strip() or "Unknown"
        owner_lower = owner.lower()
        watch_hit = owner_lower in watch_set

        created_at = _to_datetime(_pick(raw, ["CreatedTime", "created_time", "createdAt", "created_at"], None))
        updated_at = _to_datetime(_pick(raw, ["LastUpdatedTime", "updated_time", "updatedAt", "updated_at"], None))
        latest = updated_at or created_at
        if latest is None:
            continue
        if latest < cutoff and not watch_hit:
            continue

        name = str(_pick(raw, ["Name", "name", "ModelName", "model_name"], "")).strip() or model_id.split("/")[-1]
        description = str(_pick(raw, ["Description", "description", "ModelDescription"], "")).strip()

        if not watch_hit and not _keyword_match(text=f"{name} {model_id} {description}", keywords=keywords):
            continue

        downloads = _to_int(_pick(raw, ["Downloads", "downloads", "download_count"], 0), default=0)
        likes = _to_int(_pick(raw, ["Likes", "likes", "like_count"], 0), default=0)
        update_type = _infer_update_type(created_at=created_at, latest=latest)
        release_confidence = _estimate_release_confidence(
            update_type=update_type,
            watch_hit=watch_hit,
            downloads=downloads,
            likes=likes,
            model_id=model_id,
        )

        model = {
            "model_name": name,
            "source_platform": "modelscope",
            "source_uid": model_id.lower(),
            "url": f"https://modelscope.cn/models/{model_id}",
            "model_url": f"https://modelscope.cn/models/{model_id}",
            "organization": owner,
            "release_date": (created_at or latest).isoformat() if (created_at or latest) else None,
            "last_updated": latest.isoformat() if latest else None,
            "model_type": _identify_model_type(text=f"{name} {description}"),
            "description": description or f"ModelScope 模型 {model_id}",
            "github_stars": likes,
            "github_forks": 0,
            "social_mentions": downloads,
            "license": str(_pick(raw, ["License", "license"], "Unknown") or "Unknown"),
            "update_type": update_type,
            "update_summary": _build_update_summary(model_id=model_id, update_type=update_type),
            "signal_reasons": _build_signal_reasons(
                update_type=update_type,
                downloads=downloads,
                likes=likes,
                watch_hit=watch_hit,
                latest=latest,
            ),
            "signal_score": round(min(100.0, release_confidence * 0.9), 2),
            "release_confidence": round(release_confidence, 2),
            "watch_hit": watch_hit,
            "discovered_at": datetime.utcnow().isoformat(),
        }

        current = seen.get(model["source_uid"])
        if current is None:
            seen[model["source_uid"]] = model
            continue

        if float(model.get("release_confidence", 0.0)) > float(current.get("release_confidence", 0.0)):
            seen[model["source_uid"]] = model

    results = list(seen.values())
    results.sort(
        key=lambda item: (
            float(item.get("release_confidence", 0.0)),
            int(item.get("social_mentions", 0)),
        ),
        reverse=True,
    )
    return results[:max_results]


def _list_models_for_owner(api: Any, owner: str, page_size: int, max_pages: int) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        try:
            response = api.list_models(owner_or_group=owner, page_number=page, page_size=page_size)
        except Exception:
            break

        page_items = _extract_models_from_response(response)
        if not page_items:
            break

        items.extend(page_items)
        if len(page_items) < page_size:
            break
    return items


def _extract_models_from_response(response: Any) -> List[Dict[str, Any]]:
    if response is None:
        return []

    if isinstance(response, dict):
        candidates = response.get("Models")
        if isinstance(candidates, list):
            return [item for item in candidates if isinstance(item, dict)]

        if isinstance(response.get("models"), list):
            return [item for item in response["models"] if isinstance(item, dict)]

    if isinstance(response, list):
        return [item for item in response if isinstance(item, dict)]

    models = getattr(response, "Models", None)
    if isinstance(models, list):
        return [item for item in models if isinstance(item, dict)]

    return []


def _pick(data: Dict[str, Any], keys: Sequence[str], default: Any) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)

    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp /= 1000.0
        try:
            return datetime.utcfromtimestamp(timestamp)
        except (ValueError, OSError):
            return None

    text = str(value).strip()
    if not text:
        return None

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).replace(tzinfo=None)
    except ValueError:
        return None


def _keyword_match(text: str, keywords: Sequence[str]) -> bool:
    normalized = (text or "").lower()
    return any(str(keyword).lower() in normalized for keyword in keywords)


def _infer_update_type(created_at: Optional[datetime], latest: Optional[datetime]) -> str:
    if created_at and latest and (latest - created_at).total_seconds() <= 48 * 3600:
        return "new_model_repo"
    return "weights_update"


def _identify_model_type(text: str) -> str:
    normalized = (text or "").lower()
    if any(token in normalized for token in ["llm", "chat", "instruct", "reasoning"]):
        return "LLM"
    if any(token in normalized for token in ["vision", "image", "detection", "segment"]):
        return "Vision"
    if any(token in normalized for token in ["speech", "audio", "tts", "asr"]):
        return "Audio"
    if any(token in normalized for token in ["multimodal", "vlm", "vision-language"]):
        return "Multimodal"
    return "Other"


def _estimate_release_confidence(
    update_type: str,
    watch_hit: bool,
    downloads: int,
    likes: int,
    model_id: str,
) -> float:
    score = 79.0 if update_type == "new_model_repo" else 70.0

    if downloads >= 200000:
        score += 7
    elif downloads >= 50000:
        score += 5
    elif downloads >= 10000:
        score += 3

    if likes >= 1000:
        score += 6
    elif likes >= 200:
        score += 4

    if watch_hit:
        score += 6

    normalized = model_id.lower()
    if any(token in normalized for token in ["chat", "instruct", "reason", "v", "preview"]):
        score += 2

    return max(0.0, min(99.0, score))


def _build_signal_reasons(
    update_type: str,
    downloads: int,
    likes: int,
    watch_hit: bool,
    latest: Optional[datetime],
) -> List[str]:
    reasons = [
        f"update_type={update_type}",
        f"downloads={downloads}",
        f"likes={likes}",
    ]
    if watch_hit:
        reasons.append("watch_organization_hit=true")
    if latest:
        reasons.append(f"updated_at={latest.isoformat()}")
    return reasons


def _build_update_summary(model_id: str, update_type: str) -> str:
    if update_type == "new_model_repo":
        return f"ModelScope 检测到新模型条目：{model_id}"
    return f"ModelScope 检测到模型权重/配置更新：{model_id}"


if __name__ == "__main__":
    import json

    payload = discover_modelscope(days_back=7, max_results=20)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
