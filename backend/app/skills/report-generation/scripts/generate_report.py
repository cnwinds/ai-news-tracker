#!/usr/bin/env python3
"""
报告生成脚本
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from backend.app.services.exploration.markdown_formatter import to_markdown_text
from backend.app.services.exploration.report_renderer import render_professional_report


def _default_use_cases(model_type: str) -> List[str]:
    mapping = {
        "llm": ["企业知识问答", "代码辅助开发", "文档生成与改写"],
        "vision": ["图像分类与检测", "工业视觉质检", "医学影像辅助分析"],
        "audio": ["语音识别", "语音合成", "客服语音分析"],
        "multimodal": ["图文问答", "多模态检索", "跨模态内容生成"],
        "generative": ["创意内容生成", "数据增强", "快速原型制作"],
    }
    return mapping.get(model_type.lower(), ["通用研究探索", "原型验证", "定制化场景适配"])


def _default_risks(model_type: str) -> List[str]:
    risks = [
        "公开信息有限，关键实现细节可能与推断不一致",
        "缺少统一 benchmark 配置，跨模型对比可能存在偏差",
    ]
    if model_type.lower() == "llm":
        risks.append("推理成本与延迟在大规模部署场景下可能偏高")
    return risks


def generate_report(model_data: Dict[str, Any], analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    model_name = model_data.get("model_name") or "Unknown Model"
    model_type = model_data.get("model_type") or "Other"
    organization = model_data.get("organization") or "Unknown"
    release_date = model_data.get("release_date") or "Unknown"
    source_platform = model_data.get("source_platform") or "unknown"
    license_name = model_data.get("license") or "Unknown"
    extra_data = model_data.get("extra_data") if isinstance(model_data.get("extra_data"), dict) else {}
    release_confidence = float(extra_data.get("release_confidence") or 0.0)
    update_type = str(extra_data.get("update_type") or "unknown")
    watch_hit = bool(extra_data.get("watch_hit") or False)
    update_summary = str(extra_data.get("update_summary") or "").strip()

    final_score = float(model_data.get("final_score") or 0.0)
    impact_score = float(model_data.get("impact_score") or 0.0)
    quality_score = float(model_data.get("quality_score") or 0.0)
    innovation_score = float(model_data.get("innovation_score") or 0.0)
    practicality_score = float(model_data.get("practicality_score") or 0.0)

    highlights = [
        f"发布置信度 {release_confidence:.1f}/100，信号类型为 {update_type}",
        f"监控名单命中：{'是' if watch_hit else '否'}，来源平台 {source_platform}",
        f"综合评分 {final_score:.1f}/100（影响力 {impact_score:.1f}，质量 {quality_score:.1f}）",
        (
            f"更新摘要：{update_summary}"
            if update_summary
            else "更新摘要：暂未提供明确更新说明"
        ),
    ]

    use_cases = _default_use_cases(model_type)
    risks = _default_risks(model_type)
    recommendations = [
        "优先复核官方仓库/论文中的关键实验设置与评测脚本",
        "在目标业务场景做小规模离线评估，再决定是否接入生产链路",
        "关注社区 issue 和更新日志，跟踪后续稳定性变化",
    ]

    references = {
        "github": model_data.get("github_url") or "",
        "paper": model_data.get("paper_url") or "",
        "model": model_data.get("model_url") or "",
    }

    technical_analysis = to_markdown_text(analysis_data.get("architecture") or "暂无技术分析")
    performance_analysis = to_markdown_text(analysis_data.get("benchmarks") or "暂无性能分析")
    code_analysis = to_markdown_text(analysis_data.get("structure") or "暂无代码分析")

    summary = (
        f"{model_name} 来自 {organization}，来源平台为 {source_platform}。"
        f"当前发布置信度 {release_confidence:.1f}/100，更新类型为 {update_type}，"
        f"综合评分 {final_score:.1f}/100。"
        f"建议作为{'重点偷跑跟踪对象' if release_confidence >= 70 else '常规预警候选'}。"
    )

    generated_at = datetime.now()
    full_report = render_professional_report(
        model_data=model_data,
        report_data={
            "title": f"{model_name} 偷跑预警报告",
            "summary": summary,
            "highlights": highlights,
            "technical_analysis": technical_analysis,
            "performance_analysis": performance_analysis,
            "code_analysis": code_analysis,
            "use_cases": use_cases,
            "risks": risks,
            "recommendations": recommendations,
            "references": references,
            "model_used": "rule-based-evaluator",
        },
        generated_at=generated_at,
        report_version="1.0",
    )

    return {
        "title": f"{model_name} 偷跑预警报告",
        "summary": summary,
        "highlights": highlights,
        "technical_analysis": technical_analysis,
        "performance_analysis": performance_analysis,
        "code_analysis": code_analysis,
        "use_cases": use_cases,
        "risks": risks,
        "recommendations": recommendations,
        "references": references,
        "full_report": full_report,
        "model_used": "rule-based-evaluator",
        "generation_time": 0.0,
    }
