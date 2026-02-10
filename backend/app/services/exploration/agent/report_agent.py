"""
Exploration report agent using unified runtime + provider adapters.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from backend.app.services.exploration.markdown_formatter import (
    looks_like_markdown,
    normalize_bullet_item,
    to_markdown_text,
)
from backend.app.services.exploration.agent.providers import build_provider_adapter
from backend.app.services.exploration.agent.runtime import AgentRuntime
from backend.app.services.exploration.agent.types import AgentTool


SkillCaller = Callable[..., Any]
logger = logging.getLogger(__name__)


class ExplorationReportAgent:
    """Generate exploration reports in agent mode."""

    def __init__(self, provider_config: Dict[str, Any], call_skill: SkillCaller) -> None:
        self.provider_config = provider_config
        self.call_skill = call_skill
        self.workspace_root = Path(__file__).resolve().parents[5]
        self.selected_model = self._pick_model()
        self.adapter = build_provider_adapter(
            provider_type=str(self.provider_config.get("provider_type") or ""),
            api_key=str(self.provider_config.get("api_key") or ""),
            model=self.selected_model,
            api_base=self.provider_config.get("api_base"),
        )

    def generate_report(self, model_data: Dict[str, Any]) -> Dict[str, Any]:
        start = datetime.now()
        runtime = AgentRuntime(
            adapter=self.adapter,
            tools=self._build_tools(model_data),
            max_rounds=8,
            temperature=0.1,
            max_tokens=2500,
        )

        system_prompt = (
            "你是自主探索系统的技术研究代理。"
            "你必须先调用代码分析工具获取证据，再输出最终 JSON 报告。"
            "可按需调用网页抓取和文件读取工具补充证据。"
            "报告目标是判断是否存在新模型发布前（偷跑）信号。"
            "所有分析字段应使用专业 Markdown 结构（小标题+要点列表），结论必须区分事实与推断。"
            "最终输出必须是严格 JSON，不允许 markdown 代码块。"
        )
        user_prompt = (
            "请为以下模型生成详细偷跑分析报告。\n"
            f"模型元数据: {json.dumps(model_data, ensure_ascii=False)}\n\n"
            "必须至少调用以下工具各一次：analyze_structure、analyze_model_architecture、extract_benchmarks。\n"
            "如果模型存在官网/仓库/论文链接，优先使用 fetch_web_page 抓取公开信息；"
            "如果需要本地证据，可使用 list_local_files 和 read_local_file。\n"
            "报告中必须明确：发布置信度判断依据、关键触发信号、证据链一致性与反证。"
            "technical_analysis/performance_analysis/code_analysis 必须包含："
            "1) 事实证据；2) 推断结论；3) 不确定性说明。\n"
            "references 字段请尽量给出可点击 URL，并标注证据是否一致。\n"
            "最终 JSON 必须包含字段: "
            "title, summary, highlights, technical_analysis, performance_analysis, code_analysis, "
            "use_cases, risks, recommendations, references, full_report."
        )

        text = runtime.run(system_prompt=system_prompt, user_prompt=user_prompt)
        payload = self._parse_report_payload(text)
        payload["model_used"] = self.selected_model
        payload["generation_time"] = round((datetime.now() - start).total_seconds(), 3)
        return payload

    def _build_tools(self, fallback_model_data: Dict[str, Any]) -> List[AgentTool]:
        def _extract_model_data(model_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
            return model_data if isinstance(model_data, dict) and model_data else fallback_model_data

        def analyze_structure(model_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
            payload = _extract_model_data(model_data)
            result = self.call_skill(
                "code-analysis",
                "analyze_structure.py",
                "analyze_structure",
                model_data=payload,
            )
            return {"structure": result}

        def analyze_model_architecture(model_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
            payload = _extract_model_data(model_data)
            result = self.call_skill(
                "code-analysis",
                "analyze_model.py",
                "analyze_model_architecture",
                model_data=payload,
            )
            return {"architecture": result}

        def extract_benchmarks(model_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
            payload = _extract_model_data(model_data)
            result = self.call_skill(
                "code-analysis",
                "extract_benchmarks.py",
                "extract_benchmarks",
                model_data=payload,
            )
            return {"benchmarks": result}

        def fetch_web_page(
            url: str,
            max_chars: int = 12000,
            max_links: int = 20,
            timeout_seconds: int = 20,
        ) -> Dict[str, Any]:
            return self.call_skill(
                "research-tools",
                "fetch_web_page.py",
                "fetch_web_page",
                url=url,
                max_chars=self._clamp_int(max_chars, minimum=500, maximum=50000, default=12000),
                max_links=self._clamp_int(max_links, minimum=0, maximum=100, default=20),
                timeout_seconds=self._clamp_int(timeout_seconds, minimum=5, maximum=60, default=20),
            )

        def list_local_files(
            path: str = ".",
            pattern: str = "*",
            recursive: bool = True,
            max_entries: int = 120,
        ) -> Dict[str, Any]:
            safe_path = self._resolve_workspace_path(path)
            return self.call_skill(
                "research-tools",
                "list_local_files.py",
                "list_local_files",
                base_path=str(safe_path),
                pattern=pattern,
                recursive=bool(recursive),
                max_entries=self._clamp_int(max_entries, minimum=1, maximum=500, default=120),
                workspace_root=str(self.workspace_root),
            )

        def read_local_file(
            path: str,
            start_line: int = 1,
            end_line: Optional[int] = None,
            max_chars: int = 12000,
        ) -> Dict[str, Any]:
            safe_path = self._resolve_workspace_path(path)
            if not safe_path.is_file():
                return {"error": f"目标不是文件: {safe_path}"}
            return self.call_skill(
                "research-tools",
                "read_local_file.py",
                "read_local_file",
                path=str(safe_path),
                start_line=self._clamp_int(start_line, minimum=1, maximum=1000000, default=1),
                end_line=end_line,
                max_chars=self._clamp_int(max_chars, minimum=500, maximum=50000, default=12000),
                workspace_root=str(self.workspace_root),
            )

        return [
            AgentTool(
                name="analyze_structure",
                description="分析开源仓库结构、成熟度和代码组织情况。",
                input_schema={
                    "type": "object",
                    "properties": {
                        "model_data": {
                            "type": "object",
                            "description": "模型元数据，字段可包含 model_name/github_url/description 等。",
                        }
                    },
                    "required": [],
                },
                execute=analyze_structure,
            ),
            AgentTool(
                name="analyze_model_architecture",
                description="分析模型架构和关键技术路线。",
                input_schema={
                    "type": "object",
                    "properties": {
                        "model_data": {
                            "type": "object",
                            "description": "模型元数据，字段可包含 model_type/description 等。",
                        }
                    },
                    "required": [],
                },
                execute=analyze_model_architecture,
            ),
            AgentTool(
                name="extract_benchmarks",
                description="提取公开描述中的 benchmark 线索并给出验证建议。",
                input_schema={
                    "type": "object",
                    "properties": {
                        "model_data": {
                            "type": "object",
                            "description": "模型元数据，字段可包含 description 等。",
                        }
                    },
                    "required": [],
                },
                execute=extract_benchmarks,
            ),
            AgentTool(
                name="fetch_web_page",
                description="抓取网页正文与链接信息，用于补充公开证据。",
                input_schema={
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "目标网页 URL（http/https）"},
                        "max_chars": {"type": "integer", "description": "返回正文最大字符数，默认 12000"},
                        "max_links": {"type": "integer", "description": "返回链接数量上限，默认 20"},
                        "timeout_seconds": {"type": "integer", "description": "请求超时秒数，默认 20"},
                    },
                    "required": ["url"],
                },
                execute=fetch_web_page,
            ),
            AgentTool(
                name="list_local_files",
                description="列出工作区内目录文件，支持 pattern 和递归开关。",
                input_schema={
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "工作区内目录路径，默认 ."},
                        "pattern": {"type": "string", "description": "glob 匹配模式，默认 *"},
                        "recursive": {"type": "boolean", "description": "是否递归，默认 true"},
                        "max_entries": {"type": "integer", "description": "最多返回条数，默认 120"},
                    },
                    "required": [],
                },
                execute=list_local_files,
            ),
            AgentTool(
                name="read_local_file",
                description="读取工作区内指定文件内容，可按行截取。",
                input_schema={
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "工作区内文件路径"},
                        "start_line": {"type": "integer", "description": "起始行号（1-based）"},
                        "end_line": {"type": "integer", "description": "结束行号（1-based，可选）"},
                        "max_chars": {"type": "integer", "description": "最大返回字符数，默认 12000"},
                    },
                    "required": ["path"],
                },
                execute=read_local_file,
            ),
        ]

    def _resolve_workspace_path(self, raw_path: Optional[str]) -> Path:
        candidate = str(raw_path or ".").strip() or "."
        path = Path(candidate)
        resolved = path.resolve() if path.is_absolute() else (self.workspace_root / path).resolve()
        if resolved == self.workspace_root:
            return resolved
        if self.workspace_root in resolved.parents:
            return resolved
        raise ValueError("仅允许访问工作区内文件路径")

    @staticmethod
    def _clamp_int(value: Any, minimum: int, maximum: int, default: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return default
        return max(minimum, min(maximum, parsed))

    def _pick_model(self) -> str:
        selected_model = str(self.provider_config.get("selected_model") or "").strip()
        if selected_model:
            return selected_model
        models = self.provider_config.get("llm_models") or []
        if isinstance(models, list) and models:
            return str(models[0])
        return str(self.provider_config.get("llm_model") or "").strip()

    def _parse_report_payload(self, text: str) -> Dict[str, Any]:
        normalized_text = (text or "").strip()
        if normalized_text.startswith("```"):
            normalized_text = self._strip_code_fence(normalized_text)

        try:
            parsed = json.loads(normalized_text)
        except json.JSONDecodeError as exc:
            left = normalized_text.find("{")
            right = normalized_text.rfind("}")
            if left >= 0 and right > left:
                try:
                    parsed = json.loads(normalized_text[left : right + 1])
                except json.JSONDecodeError as nested_exc:
                    logger.warning("Agent JSON 解析失败，回退 Markdown 解析: %s", nested_exc)
                    return self._build_payload_from_raw_text(normalized_text)
            else:
                logger.warning("Agent JSON 解析失败，回退 Markdown 解析: %s", exc)
                return self._build_payload_from_raw_text(normalized_text)
        if not isinstance(parsed, dict):
            logger.warning("Agent JSON 顶层不是对象，回退 Markdown 解析。")
            return self._build_payload_from_raw_text(normalized_text)

        payload: Dict[str, Any] = {
            "title": str(parsed.get("title") or "模型详细分析报告"),
            "summary": str(parsed.get("summary") or ""),
            "highlights": self._normalize_str_list(parsed.get("highlights")),
            "technical_analysis": to_markdown_text(parsed.get("technical_analysis") or ""),
            "performance_analysis": to_markdown_text(parsed.get("performance_analysis") or ""),
            "code_analysis": to_markdown_text(parsed.get("code_analysis") or ""),
            "use_cases": self._normalize_str_list(parsed.get("use_cases")),
            "risks": self._normalize_str_list(parsed.get("risks")),
            "recommendations": self._normalize_str_list(parsed.get("recommendations")),
            "references": self._normalize_references(parsed.get("references")),
            "full_report": to_markdown_text(parsed.get("full_report") or ""),
        }
        if not payload["full_report"] or not looks_like_markdown(payload["full_report"]):
            payload["full_report"] = self._build_minimal_report(payload)
        return payload

    def _build_payload_from_raw_text(self, raw_text: str) -> Dict[str, Any]:
        markdown = to_markdown_text(raw_text or "")
        sections = self._extract_markdown_sections(markdown)

        title = self._extract_markdown_title(markdown) or "模型详细分析报告"
        summary = self._pick_summary(markdown, sections)
        highlights = self._extract_bullet_items(sections.get("核心亮点", ""))
        technical = sections.get("技术分析", "").strip()
        performance = sections.get("性能分析", "").strip()
        code = sections.get("代码分析", "").strip()

        payload: Dict[str, Any] = {
            "title": title,
            "summary": summary,
            "highlights": highlights,
            "technical_analysis": technical,
            "performance_analysis": performance,
            "code_analysis": code,
            "use_cases": [],
            "risks": [],
            "recommendations": [],
            "references": {},
            "full_report": markdown.strip(),
        }
        if not payload["full_report"] or not looks_like_markdown(payload["full_report"]):
            payload["full_report"] = self._build_minimal_report(payload)
        return payload

    @staticmethod
    def _extract_markdown_title(text: str) -> str:
        match = re.search(r"(?m)^\s*#\s+(.+?)\s*$", text or "")
        return match.group(1).strip() if match else ""

    @staticmethod
    def _extract_markdown_sections(markdown: str) -> Dict[str, str]:
        sections: Dict[str, List[str]] = {}
        current = ""
        for line in (markdown or "").splitlines():
            heading = re.match(r"^\s*##\s+(.+?)\s*$", line)
            if heading:
                current = heading.group(1).strip()
                sections[current] = []
                continue
            if current:
                sections[current].append(line)
        return {key: "\n".join(lines).strip() for key, lines in sections.items()}

    def _pick_summary(self, markdown: str, sections: Dict[str, str]) -> str:
        summary = (sections.get("摘要") or "").strip()
        if summary:
            return summary
        lines = [
            line.strip()
            for line in (markdown or "").splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        return lines[0] if lines else ""

    def _extract_bullet_items(self, section_text: str) -> List[str]:
        items: List[str] = []
        for line in (section_text or "").splitlines():
            match = re.match(r"^\s*[-*+]\s+(.+?)\s*$", line)
            if not match:
                continue
            item = normalize_bullet_item(match.group(1))
            if item:
                items.append(item)
        return items

    @staticmethod
    def _strip_code_fence(text: str) -> str:
        lines = text.splitlines()
        content_lines: List[str] = []
        in_fence = False
        for line in lines:
            if line.strip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                content_lines.append(line)
        return "\n".join(content_lines).strip() if content_lines else text

    @staticmethod
    def _normalize_str_list(value: Any) -> List[str]:
        if isinstance(value, list):
            cleaned = [normalize_bullet_item(item) for item in value]
            return [item for item in cleaned if item]
        if isinstance(value, str) and value.strip():
            item = normalize_bullet_item(value)
            return [item] if item else []
        return []

    @staticmethod
    def _normalize_references(value: Any) -> Dict[str, str]:
        if isinstance(value, dict):
            normalized: Dict[str, str] = {}
            for key, item in value.items():
                text = str(item).strip()
                if text:
                    normalized[str(key)] = text
            return normalized
        return {}

    @staticmethod
    def _build_minimal_report(payload: Dict[str, Any]) -> str:
        highlights = "\n".join(f"- {item}" for item in payload.get("highlights", []))
        return (
            f"# {payload.get('title', '模型详细分析报告')}\n\n"
            f"## 摘要\n{payload.get('summary', '')}\n\n"
            f"## 核心亮点\n{highlights or '- 暂无'}\n\n"
            f"## 技术分析\n{payload.get('technical_analysis', '')}\n\n"
            f"## 性能分析\n{payload.get('performance_analysis', '')}\n\n"
            f"## 代码分析\n{payload.get('code_analysis', '')}\n"
        )
