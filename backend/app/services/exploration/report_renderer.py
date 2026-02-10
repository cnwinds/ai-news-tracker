"""
Professional markdown report renderer for autonomous exploration.
"""
from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional


def render_professional_report(
    *,
    model_data: Dict[str, Any],
    report_data: Dict[str, Any],
    generated_at: datetime,
    report_version: str = "1.0",
) -> str:
    template = _load_template()
    values = _build_template_values(
        model_data=model_data,
        report_data=report_data,
        generated_at=generated_at,
        report_version=report_version,
    )
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", value)
    return rendered.strip()


def _build_template_values(
    *,
    model_data: Dict[str, Any],
    report_data: Dict[str, Any],
    generated_at: datetime,
    report_version: str,
) -> Dict[str, str]:
    title = str(report_data.get("title") or f"{model_data.get('model_name') or '模型'} 偷跑预警报告").strip()
    summary = str(report_data.get("summary") or "暂无摘要").strip()
    model_used = str(report_data.get("model_used") or "unknown").strip() or "unknown"
    extra_data = _extract_extra_data(model_data)

    release_confidence_value = _extract_release_confidence(model_data)
    leak_signal_level = _signal_level(release_confidence_value)

    highlights = _to_bullets(report_data.get("highlights"), default_item="暂无关键发现")
    signal_reasons = _to_bullets(extra_data.get("signal_reasons"), default_item="暂无明确触发原因")
    use_cases = _to_bullets(report_data.get("use_cases"), default_item="暂无明确应用场景")
    risks = _to_bullets(report_data.get("risks"), default_item="暂无显著风险信息")
    recommendations = _to_bullets(report_data.get("recommendations"), default_item="暂无明确建议")

    technical_analysis = _to_markdown_block(report_data.get("technical_analysis"), empty_text="暂无技术分析")
    performance_analysis = _to_markdown_block(report_data.get("performance_analysis"), empty_text="暂无性能分析")
    code_analysis = _to_markdown_block(report_data.get("code_analysis"), empty_text="暂无代码分析")
    references = _format_references(report_data.get("references"))
    conclusion = _build_conclusion(model_data=model_data, report_data=report_data)

    return {
        "title": title,
        "generated_at": generated_at.strftime("%Y-%m-%d %H:%M:%S"),
        "model_used": model_used,
        "report_version": report_version,
        "summary": summary,
        "conclusion": conclusion,
        "leak_signal_level": leak_signal_level,
        "release_confidence": _display_confidence(release_confidence_value),
        "update_type": _display(extra_data.get("update_type")),
        "watch_hit": _display_yes_no(extra_data.get("watch_hit")),
        "updated_at": _display_datetime(extra_data.get("updated_at")),
        "discovered_at": _display_datetime(extra_data.get("discovered_at")),
        "source_url": _format_link(extra_data.get("source_url")),
        "update_summary": _to_markdown_block(extra_data.get("update_summary"), empty_text="暂无更新摘要"),
        "signal_reasons": signal_reasons,
        "highlights": highlights,
        "github_url": _format_link(model_data.get("github_url")),
        "model_url": _format_link(model_data.get("model_url")),
        "paper_url": _format_link(model_data.get("paper_url")),
        "model_name": _display(model_data.get("model_name")),
        "organization": _display(model_data.get("organization")),
        "model_type": _display(model_data.get("model_type")),
        "source_platform": _display(model_data.get("source_platform")),
        "source_uid": _display(model_data.get("source_uid")),
        "release_date": _display_datetime(model_data.get("release_date")),
        "license": _display(model_data.get("license")),
        "github_stars": _display_int(model_data.get("github_stars")),
        "github_forks": _display_int(model_data.get("github_forks")),
        "paper_citations": _display_int(model_data.get("paper_citations")),
        "social_mentions": _display_int(model_data.get("social_mentions")),
        "final_score": _display_score(model_data.get("final_score")),
        "impact_score": _display_score(model_data.get("impact_score")),
        "quality_score": _display_score(model_data.get("quality_score")),
        "innovation_score": _display_score(model_data.get("innovation_score")),
        "practicality_score": _display_score(model_data.get("practicality_score")),
        "technical_analysis": technical_analysis,
        "performance_analysis": performance_analysis,
        "code_analysis": code_analysis,
        "use_cases": use_cases,
        "risks": risks,
        "recommendations": recommendations,
        "references": references,
    }


def _build_conclusion(*, model_data: Dict[str, Any], report_data: Dict[str, Any]) -> str:
    confidence = _extract_release_confidence(model_data)
    score = _to_float(model_data.get("final_score"), default=0.0)

    if confidence is None:
        confidence_note = "未获取到可计算的发布置信度，当前仅能给出人工预警结论"
    elif confidence >= 85:
        confidence_note = "存在高概率新模型发布前信号"
    elif confidence >= 70:
        confidence_note = "存在较强预发布信号，建议提升监控频率"
    elif confidence >= 60:
        confidence_note = "存在初步预发布线索，建议继续观察"
    else:
        confidence_note = "当前信号偏弱，噪声可能性较高"

    if score >= 85:
        priority = "高优先级"
    elif score >= 70:
        priority = "中高优先级"
    else:
        priority = "常规优先级"

    risk_text = " ".join(str(item) for item in _to_list(report_data.get("risks")))
    weak_signal = any(token in risk_text for token in ["404", "无法验证", "未检测到", "不一致", "缺失"])
    evidence_note = (
        "证据链存在缺口或冲突，需谨慎对待当前结论。"
        if weak_signal
        else "证据链整体可追溯，建议持续补充新增证据。"
    )
    return f"{confidence_note}；研判优先级：{priority}。{evidence_note}"


def _extract_extra_data(model_data: Dict[str, Any]) -> Dict[str, Any]:
    value = model_data.get("extra_data")
    return value if isinstance(value, dict) else {}


def _extract_release_confidence(model_data: Dict[str, Any]) -> Optional[float]:
    extra_data = _extract_extra_data(model_data)
    raw = extra_data.get("release_confidence")
    if raw is None:
        raw = model_data.get("release_confidence")
    value = _to_float(raw, default=-1.0)
    if value < 0:
        return None
    return max(0.0, min(100.0, value))


def _signal_level(confidence: Optional[float]) -> str:
    if confidence is None:
        return "未知（缺少置信度）"
    if confidence >= 85:
        return "高（强偷跑信号）"
    if confidence >= 70:
        return "中高（重点跟踪）"
    if confidence >= 60:
        return "中（候选预警）"
    return "低（噪声可能较大）"


def _to_bullets(value: Any, *, default_item: str) -> str:
    items = [str(item).strip() for item in _to_list(value) if str(item).strip()]
    if not items:
        items = [default_item]
    return "\n".join(f"- {item}" for item in items)


def _format_references(value: Any) -> str:
    if isinstance(value, dict):
        lines: List[str] = []
        for key, raw in value.items():
            text = str(raw or "").strip()
            if not text:
                continue
            label = str(key).strip() or "reference"
            if text.startswith(("http://", "https://")):
                lines.append(f"- **{label}**: [{text}]({text})")
            else:
                lines.append(f"- **{label}**: {text}")
        if lines:
            return "\n".join(lines)
    return "- 暂无公开引用链接"


def _to_markdown_block(value: Any, *, empty_text: str) -> str:
    text = str(value or "").strip()
    return text if text else empty_text


def _to_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def _to_float(value: Any, *, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _display(value: Any) -> str:
    text = str(value).strip() if value is not None else ""
    text = text.replace("|", "\\|").replace("\n", "<br>")
    return text or "N/A"


def _display_int(value: Any) -> str:
    try:
        return f"{int(value)}"
    except (TypeError, ValueError):
        return "0"


def _display_score(value: Any) -> str:
    try:
        return f"{float(value):.1f}"
    except (TypeError, ValueError):
        return "0.0"


def _display_confidence(value: Optional[float]) -> str:
    if value is None:
        return "N/A"
    return f"{value:.1f} / 100"


def _display_yes_no(value: Any) -> str:
    if isinstance(value, bool):
        return "是" if value else "否"
    text = str(value or "").strip().lower()
    if text in {"1", "true", "yes", "y"}:
        return "是"
    if text in {"0", "false", "no", "n"}:
        return "否"
    return "否"


def _display_datetime(value: Any) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    text = str(value).strip()
    if not text:
        return "N/A"
    candidate = text
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(candidate)
        return parsed.replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return _display(text)


def _format_link(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return "N/A"
    if text.startswith(("http://", "https://")):
        return f"[{text}]({text})"
    return _display(text)


@lru_cache(maxsize=1)
def _load_template() -> str:
    template_path = (
        Path(__file__).resolve().parents[2]
        / "skills"
        / "report-generation"
        / "assets"
        / "report_template.md"
    )
    if not template_path.exists():
        return (
            "# {{title}}\n\n"
            "## 1. 偷跑判定结论\n"
            "- 信号等级：**{{leak_signal_level}}**\n"
            "- 发布置信度：**{{release_confidence}}**\n"
            "- 判定结论：{{conclusion}}\n\n"
            "## 2. 关键发现\n{{highlights}}\n\n"
            "## 3. 技术分析\n{{technical_analysis}}\n\n"
            "## 4. 性能与基准\n{{performance_analysis}}\n\n"
            "## 5. 代码与工程实现\n{{code_analysis}}\n\n"
            "## 6. 风险与反证\n{{risks}}\n\n"
            "## 7. 后续行动建议\n{{recommendations}}\n\n"
            "## 8. 证据与引用\n{{references}}\n"
        )
    return template_path.read_text(encoding="utf-8")
