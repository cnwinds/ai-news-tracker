#!/usr/bin/env python3
"""
arXiv 平台模型先知发现脚本。
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)


def discover_arxiv(
    keywords: Optional[List[str]] = None,
    days_back: int = 7,
    max_results: int = 50,
    watch_organizations: Optional[List[str]] = None,
) -> List[Dict]:
    try:
        import arxiv
    except ImportError:
        return []

    if keywords is None:
        keywords = ["large language model", "reasoning model", "multimodal model", "foundation model"]

    watch_set = {item.strip().lower() for item in (watch_organizations or []) if item and item.strip()}
    cutoff = datetime.utcnow() - timedelta(days=days_back)

    keyword_query = " OR ".join([f'ti:"{kw}" OR abs:"{kw}"' for kw in keywords[:4]])
    category_query = "cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV"
    query = f"({keyword_query}) AND ({category_query})"

    # 调试日志
    logger.info(f"[arXiv Debug] Starting search: keywords={keywords}, days_back={days_back}, watch_orgs={list(watch_set)}")
    logger.info(f"[arXiv Debug] Query: {query[:200]}...")

    try:
        search = arxiv.Search(
            query=query,
            max_results=max_results * 4,
            sort_by=arxiv.SortCriterion.SubmittedDate,
            sort_order=arxiv.SortOrder.Descending,
        )
    except Exception as e:
        logger.error(f"[arXiv Debug] Search creation failed: {e}")
        return []

    results: List[Dict] = []
    total_results = 0
    filtered_no_date = 0
    filtered_cutoff = 0
    filtered_no_keyword = 0

    for paper in search.results():
        total_results += 1
        published = paper.published.replace(tzinfo=None) if paper.published else None
        updated = paper.updated.replace(tzinfo=None) if getattr(paper, "updated", None) else published
        if published is None:
            filtered_no_date += 1
            continue

        author_names = [author.name for author in (paper.authors or [])]
        watch_hit = _watch_author_hit(author_names=author_names, watch_set=watch_set)

        if published < cutoff and not watch_hit:
            filtered_cutoff += 1
            continue

        summary = str(paper.summary or "").strip()
        title = str(paper.title or "").strip()
        if not watch_hit and not _keyword_match(text=f"{title} {summary}", keywords=keywords):
            filtered_no_keyword += 1
            if total_results <= 10:
                logger.debug(f"[arXiv Debug] Filtered (no keyword): {title[:80]}")
            continue

        github_url = _extract_github_url(summary)
        update_type = "paper_code_release" if github_url else "new_research_signal"
        signal_reasons = _build_signal_reasons(
            update_type=update_type,
            watch_hit=watch_hit,
            author_count=len(author_names),
            has_github=bool(github_url),
            updated=updated,
        )
        release_confidence = _estimate_release_confidence(
            update_type=update_type,
            watch_hit=watch_hit,
            has_github=bool(github_url),
            title=title,
        )

        model_name = _extract_model_name(title) or title[:80]
        entry_url = str(paper.entry_id or "").strip()

        model_info: Dict = {
            "model_name": model_name,
            "source_platform": "arxiv",
            "source_uid": _extract_arxiv_id(entry_url),
            "url": entry_url,
            "paper_url": entry_url,
            "organization": ", ".join(author_names[:3]) if author_names else "Unknown",
            "release_date": published.isoformat(),
            "last_updated": updated.isoformat() if updated else published.isoformat(),
            "model_type": _identify_model_type(text=f"{title} {summary}"),
            "description": summary[:400],
            "github_stars": 0,
            "github_forks": 0,
            "paper_citations": 0,
            "license": "Unknown",
            "update_type": update_type,
            "update_summary": _build_update_summary(title=title, update_type=update_type),
            "signal_reasons": signal_reasons,
            "signal_score": round(min(100.0, release_confidence * 0.85), 2),
            "release_confidence": round(release_confidence, 2),
            "watch_hit": watch_hit,
            "discovered_at": datetime.utcnow().isoformat(),
        }

        if github_url:
            model_info["github_url"] = github_url

        results.append(model_info)
        if len(results) >= max_results:
            break

    # 汇总日志
    logger.info(f"[arXiv Debug] === Summary ===")
    logger.info(f"[arXiv Debug] Total papers found: {total_results}")
    logger.info(f"[arXiv Debug] Filtered (no date): {filtered_no_date}")
    logger.info(f"[arXiv Debug] Filtered (cutoff date): {filtered_cutoff}")
    logger.info(f"[arXiv Debug] Filtered (no keyword): {filtered_no_keyword}")
    logger.info(f"[arXiv Debug] Final results: {len(results)}")

    if results:
        logger.info(f"[arXiv Debug] Top 3 results:")
        for i, r in enumerate(results[:3]):
            logger.info(f"[arXiv Debug]   {i+1}. {r.get('model_name')} by {r.get('organization')[:50]} (confidence={r.get('release_confidence')})")

    results.sort(key=lambda item: float(item.get("release_confidence", 0.0)), reverse=True)
    return results[:max_results]


def _keyword_match(text: str, keywords: Sequence[str]) -> bool:
    normalized = text.lower()
    return any(str(keyword).lower() in normalized for keyword in keywords)


def _watch_author_hit(author_names: Sequence[str], watch_set: set[str]) -> bool:
    if not watch_set:
        return False
    normalized_authors = [name.lower() for name in author_names]
    for watch in watch_set:
        if any(watch in author for author in normalized_authors):
            return True
    return False


def _extract_github_url(text: str) -> Optional[str]:
    match = re.search(r"https?://github\.com/[\w.-]+/[\w.-]+", text or "")
    return match.group(0) if match else None


def _extract_model_name(title: str) -> Optional[str]:
    """
    从 arXiv 论文标题中提取可能的模型名称。

    策略：
    1. 查找标题中的首字母大写的缩写（如 GPT-4, BERT, LLaMA）
    2. 如果没找到，返回标题的前80个字符
    """
    if not title:
        return None

    # 常见模型名称模式：大写字母开头，可能包含数字和连字符
    # 例如: GPT-4, BERT, LLaMA, ViT, CLIP, Stable Diffusion
    model_patterns = [
        r"\b([A-Z]{2,}(?:[-\.]?\d+[A-Z]*)?)\b",  # GPT-4, BERT, LLaMA
        r"\b([A-Z][a-z]+(?:[- ][A-Z][a-z]+)+)\b",  # Stable Diffusion, Vision Transformer
        r"\b([A-Z]{2,}[a-z]*\d+[A-Z]*)\b",  # ViT, CLIP
    ]

    # 排除常见的非模型名称
    excludes = {
        "THE", "WITH", "MODEL", "LLM", "NLP", "AI", "FOR", "AND", "AN", "OF",
        "IN", "ON", "BASED", "USING", "VIA", "THROUGH", "LEARNING", "TRAINING",
        "APPROACH", "METHOD", "SYSTEM", "FRAMEWORK", "NETWORK", "AUGMENTED",
        "EFFICIENT", "SCALABLE", "ROBUST", "END", "NOVEMBER", "OCTOBER", "IEEE",
        "PREPRINT", "ARXIV", "HTTPS", "COM", "ORG", "PDF", "FIRST", "SECOND",
    }

    for pattern in model_patterns:
        matches = re.findall(pattern, title)
        for candidate in matches:
            candidate_upper = candidate.upper().replace("-", "").replace(" ", "")
            if candidate_upper in excludes:
                continue
            if len(candidate) >= 3:
                return candidate

    # 如果没找到合适的模型名称，返回标题的简化版本
    # 提取标题的主要部分（去除冒号后的内容）
    if ":" in title:
        main_title = title.split(":")[0].strip()
    else:
        main_title = title.strip()

    # 返回标题的前80个字符，作为模型名称的备选
    return main_title[:80]


def _extract_arxiv_id(url: str) -> str:
    match = re.search(r"arxiv\.org/(?:abs|pdf)/([0-9]+\.[0-9]+)(?:v[0-9]+)?", url or "")
    if match:
        return match.group(1)
    fallback = (url or "").strip()
    return fallback.lower()


def _identify_model_type(text: str) -> str:
    normalized = text.lower()
    if any(token in normalized for token in ["llm", "language model", "reasoning", "transformer"]):
        return "LLM"
    if any(token in normalized for token in ["vision", "image", "diffusion", "video"]):
        return "Vision"
    if any(token in normalized for token in ["speech", "audio", "asr", "tts"]):
        return "Audio"
    if any(token in normalized for token in ["multimodal", "vlm", "vision-language"]):
        return "Multimodal"
    return "Other"


def _build_signal_reasons(
    update_type: str,
    watch_hit: bool,
    author_count: int,
    has_github: bool,
    updated: Optional[datetime],
) -> List[str]:
    reasons = [f"update_type={update_type}", f"author_count={author_count}"]
    if has_github:
        reasons.append("code_link_detected=true")
    if watch_hit:
        reasons.append("watch_organization_hit=true")
    if updated:
        reasons.append(f"updated_at={updated.isoformat()}")
    return reasons


def _estimate_release_confidence(
    update_type: str,
    watch_hit: bool,
    has_github: bool,
    title: str,
) -> float:
    score = 74.0 if update_type == "paper_code_release" else 62.0
    if has_github:
        score += 6.0
    if watch_hit:
        score += 8.0
    if any(token in (title or "").lower() for token in ["release", "checkpoint", "open-source"]):
        score += 3.0
    return max(0.0, min(99.0, score))


def _build_update_summary(title: str, update_type: str) -> str:
    if update_type == "paper_code_release":
        return f"检测到论文与代码同向更新信号：{title[:80]}"
    return f"检测到新的研究信号，可能指向后续模型发布：{title[:80]}"


if __name__ == "__main__":
    import json

    payload = discover_arxiv(
        days_back=7,
        max_results=20,
        watch_organizations=["deepmind", "openai", "meta"],
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
