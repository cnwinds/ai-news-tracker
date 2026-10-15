"""
总结报告配图：解析报告结构，并用 LLM 生成可随主题换色的 SVG 信息图
"""
import logging
import math
import re
import threading
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)

ILLUSTRATION_VERSION = 2
MAX_TRENDS = 4
MAX_SVG_BYTES = 80_000
MAX_COMPLETION_TOKENS = 32_000


@dataclass(frozen=True)
class ArtCanvas:
    """配图画布：比例与前端展示位一致，字号按展示时的缩放换算，保证缩小后仍可读"""

    width: int
    height: int
    # 阅读器中该展示位的典型宽度区间（px）：窄屏约 440，宽屏约 880
    display_min: int
    display_max: int

    @property
    def viewbox(self) -> str:
        return f"0 0 {self.width} {self.height}"

    def font_px(self, screen_px: float) -> int:
        """在最窄展示宽度下渲染为 screen_px 所需的画布字号"""
        return math.ceil(screen_px * self.width / self.display_min)

    def prompt_params(self) -> Dict[str, Any]:
        gcd = math.gcd(self.width, self.height)
        return {
            "viewbox": self.viewbox,
            "width": self.width,
            "height": self.height,
            "ratio": f"{self.width // gcd}:{self.height // gcd}",
            "display_min": self.display_min,
            "display_max": self.display_max,
            "scale_min": round(100 * self.display_min / self.width),
            "scale_max": round(100 * self.display_max / self.width),
            "font_min": self.font_px(12),
            "font_max": self.font_px(16),
            "gap": self.font_px(8),
            "stroke_min": self.font_px(1.2),
            "stroke_max": self.font_px(2),
            "dot": self.font_px(2.5),
            "pad_min": self.font_px(12),
            "pad_max": self.font_px(20),
        }


# 与前端 .sd-cover / .sd-trend__art 的占满整行展示位保持同一比例（见 SvgArt.tsx ART_CANVAS）
COVER_CANVAS = ArtCanvas(width=960, height=360, display_min=440, display_max=880)
TREND_CANVAS = ArtCanvas(width=960, height=400, display_min=440, display_max=880)
COVER_VIEWBOX = COVER_CANVAS.viewbox
TREND_VIEWBOX = TREND_CANVAS.viewbox

# ---------------------------------------------------------------------------
# 报告结构解析（与前端 components/summary/parse.ts 的规则保持一致）
# ---------------------------------------------------------------------------

_HEADING_MD = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$")
_HEADING_BOLD = re.compile(r"^\*\*(.+?)\*\*\s*$")
_BOLD_SECTION = re.compile(r"^[【\[]|^[一二三四五六七八九十\d]+\s*[、.．]")
_LIST_ITEM = re.compile(r"^(\s*)(?:[-*+]|\d+[.)、])\s+(.*)$")
_LEAD_BOLD = re.compile(r"^\*\*(.+?)\*\*")
_TREND_PREFIX = re.compile(r"^(?:[（(]可选[)）])?\s*趋势\s*[一二三四五六七八九十\d]+\s*[：:]\s*")
_ARTICLE_LINK = re.compile(r"\[\*{0,2}(.+?)\*{0,2}\]\(([^)]*)\)")
_SOURCE_SUFFIX = re.compile(r"\s*[（(]([^（）()]+)[)）]\s*$")
_TRENDS_HEADING = re.compile(r"趋势|洞察|热点")
_ARTICLES_HEADING = re.compile(r"文章|要闻|头条|新闻")


def _split_sections(content: str) -> List[Dict[str, Any]]:
    sections: List[Dict[str, Any]] = []
    current: Dict[str, Any] = {"title": "", "lines": []}
    for raw in content.replace("\r\n", "\n").split("\n"):
        md = _HEADING_MD.match(raw)
        bold = _HEADING_BOLD.match(raw) if not raw.startswith((" ", "\t")) else None
        title = None
        if md:
            title = md.group(1)
        elif bold and _BOLD_SECTION.search(bold.group(1).strip()):
            title = bold.group(1)
        if title is not None:
            sections.append(current)
            current = {"title": title.strip(), "lines": []}
        else:
            current["lines"].append(raw)
    sections.append(current)
    return [s for s in sections if s["title"] or any(line.strip() for line in s["lines"])]


def _top_level_items(lines: List[str]) -> List[str]:
    """返回顶层列表项的首行文本"""
    items: List[str] = []
    base_indent: Optional[int] = None
    for line in lines:
        m = _LIST_ITEM.match(line)
        if not m:
            continue
        indent = len(m.group(1).expandtabs(4))
        if base_indent is None:
            base_indent = indent
        if indent <= base_indent:
            items.append(m.group(2).strip())
    return items


def clean_trend_title(text: str) -> str:
    title = _TREND_PREFIX.sub("", text.strip())
    return title.strip().strip("*").strip("[]【】").strip()


def extract_trend_titles(content: str) -> List[str]:
    """提取报告中的趋势标题（按出现顺序）"""
    if not content:
        return []
    titles: List[str] = []
    for section in _split_sections(content):
        if not _TRENDS_HEADING.search(section["title"]):
            continue
        for item in _top_level_items(section["lines"]):
            lead = _LEAD_BOLD.match(item)
            if lead:
                title = clean_trend_title(lead.group(1))
                if title:
                    titles.append(title)
    return titles[:MAX_TRENDS]


def extract_article_titles(content: str) -> List[str]:
    if not content:
        return []
    titles: List[str] = []
    for section in _split_sections(content):
        if not _ARTICLES_HEADING.search(section["title"]):
            continue
        for item in _top_level_items(section["lines"]):
            m = _ARTICLE_LINK.match(item)
            if m:
                titles.append(_SOURCE_SUFFIX.sub("", m.group(1).strip("* ")).strip())
    return titles


def extract_headline(content: str) -> Optional[str]:
    trends = extract_trend_titles(content)
    if trends:
        return trends[0]
    articles = extract_article_titles(content)
    return articles[0] if articles else None


# ---------------------------------------------------------------------------
# SVG 安全清洗
# ---------------------------------------------------------------------------

_ALLOWED_TAGS = {
    "svg", "g", "defs", "title", "desc", "path", "rect", "circle", "ellipse", "line",
    "polyline", "polygon", "text", "tspan", "linearGradient", "radialGradient", "stop",
    "clipPath", "mask", "marker", "pattern", "symbol", "use",
}
_ALLOWED_ATTRS = {
    "id", "class", "viewBox", "preserveAspectRatio", "transform", "d", "x", "y", "x1", "y1",
    "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "points", "dx", "dy",
    "text-anchor", "dominant-baseline", "alignment-baseline", "font-size", "font-weight",
    "font-family", "letter-spacing", "opacity", "fill-opacity", "stroke-opacity", "stroke-width",
    "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit",
    "fill-rule", "clip-rule", "clip-path", "mask", "marker-start", "marker-mid", "marker-end",
    "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits", "offset", "stop-opacity",
    "gradientUnits", "gradientTransform", "fx", "fy", "patternUnits", "patternTransform",
    "href", "{%s}href" % XLINK_NS, "style",
}
_URL_REF = re.compile(r"url\(\s*['\"]?([^)'\"]*)['\"]?\s*\)", re.IGNORECASE)
_UNSAFE_STYLE = re.compile(r"expression|javascript:|@import|behavior", re.IGNORECASE)


def _local(tag: str) -> str:
    return tag.split("}", 1)[1] if tag.startswith("{") else tag


def _safe_value(value: str) -> bool:
    if _UNSAFE_STYLE.search(value):
        return False
    return all(ref.startswith("#") for ref in _URL_REF.findall(value))


def _clean_element(el: ET.Element) -> None:
    for child in list(el):
        if not isinstance(child.tag, str) or _local(child.tag) not in _ALLOWED_TAGS:
            el.remove(child)
            continue
        _clean_element(child)
    for name in list(el.attrib):
        value = el.attrib[name]
        local = _local(name)
        keep = (
            (name in _ALLOWED_ATTRS or local in ("fill", "stroke"))
            and not local.lower().startswith("on")
            and _safe_value(value)
        )
        if keep and local == "href" and not value.startswith("#"):
            keep = False
        if not keep:
            del el.attrib[name]


def sanitize_svg(raw: str, viewbox: str) -> Optional[str]:
    """提取并清洗 LLM 输出的 SVG，失败返回 None"""
    if not raw:
        return None
    match = re.search(r"<svg\b.*</svg>", raw, re.DOTALL | re.IGNORECASE)
    if not match:
        return None
    text = match.group(0)
    if re.search(r"<!DOCTYPE|<!ENTITY", text, re.IGNORECASE) or len(text.encode("utf-8")) > MAX_SVG_BYTES:
        return None
    if "xmlns=" not in text.split(">", 1)[0]:
        text = text.replace("<svg", f'<svg xmlns="{SVG_NS}"', 1)
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        logger.warning(f"配图 SVG 解析失败: {exc}")
        return None
    if _local(root.tag) != "svg":
        return None
    _clean_element(root)
    for attr in ("width", "height", "style"):
        root.attrib.pop(attr, None)
    root.set("viewBox", root.get("viewBox") or viewbox)
    if len(root) == 0:
        return None
    return ET.tostring(root, encoding="unicode")


# ---------------------------------------------------------------------------
# 生成
# ---------------------------------------------------------------------------

_STYLE_GUIDE = """你是一名顶级信息设计师（风格参考 The Economist、Bloomberg Businessweek、Stripe Press 的编辑插图），为一份 AI 行业情报简报绘制 SVG 插图。读者是每天要处理海量信息的决策者，图要让人 3 秒内看懂「发生了什么变化」。

## 硬性规则
1. 只输出一个完整的 <svg> 元素，不要 Markdown 代码块，不要解释，不要注释。
2. 根元素写 xmlns="http://www.w3.org/2000/svg" 和 viewBox="{viewbox}"（画布 {width}×{height}），不要写 width/height，坐标不要超出画布。
3. 背景透明：禁止画铺满画布或占画布一半以上面积的背景矩形。
4. 颜色只能通过 class 指定（页面按明暗主题自动换色）；禁止 fill/stroke 颜色值，禁止 style 属性和 <style>：
   - 填充：f-ink f-muted f-panel(浅灰块) f-accent(青绿主色) f-accent-soft(主色浅底) f-cool(蓝) f-violet(紫) f-warn(琥珀) f-hot(玫红) f-on-accent(放在 f-accent 色块上的文字) f-none
   - 描边：s-ink s-muted s-line(细线) s-accent s-cool s-violet s-warn s-hot
   - 渐变色标 <stop class="st-accent|st-cool|st-violet|st-warn|st-hot|st-ink" offset=".." stop-opacity=".."/>，渐变用 fill="url(#id)" 引用
5. 禁止：<script> <foreignObject> <image> <style>、外部链接、事件属性、动画。
6. 文字：只用于短标签，中文不超过 6 个字，font-size {font_min}–{font_max}，font-weight 600；按「每个汉字宽 ≈ font-size」估算宽度，文字之间、文字与图形边缘至少留 {gap}px，绝不重叠、绝不超出画布；文字放在色块外侧，或放在足够大的色块内部（f-accent 色块里的文字用 f-on-accent）。

## 尺寸（按展示位设计）
- 这张图在页面上横向占满一整行，实际显示宽度约 {display_min}–{display_max}px，即画布会被缩小到 {scale_min}%–{scale_max}%。
- 所以字号不小于 {font_min}（缩小后约 12px），线宽 {stroke_min}–{stroke_max}，小圆点半径不小于 {dot}，焦点图形的最小尺寸不小于画布高度的 1/3。
- 画布是 {ratio} 的宽幅：主体要沿水平方向展开、填满左右两侧，不要只在中间画一个方形构图而两边留空。

## 构图质量
- 主体图形占画布面积 70% 以上，四周留 {pad_min}–{pad_max}px 边距，不要把小图形缩在角落。
- 至少 10 个图形元素，形成清晰的主次层级：1 个视觉焦点（最大、用主色）＋若干配角（cool/violet/warn）＋细线与小圆点等细节。
- 用图形隐喻表达机制：汇聚/分流、阶梯上升、曲线拐点、轨道与卫星、天平对比、漏斗、分层堆叠、网络节点、前后对照。
- 几何、扁平、网格对齐；圆角统一；线宽统一；可用 1–2 个线性渐变增加质感。
- 禁止卡通人物、表情、写实物体、剪贴画、段落文字。

## 质量示例（仅示范风格与密度，不要照抄构图；示例画布是 640×360，坐标、字号、线宽请按你的画布 {width}×{height} 与上面的尺寸规则重新设计）
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="st-accent"/><stop offset="1" class="st-cool"/></linearGradient></defs><circle cx="320" cy="180" r="150" class="f-none s-line" stroke-width="2" stroke-dasharray="4 8"/><circle cx="320" cy="180" r="100" class="f-none s-line" stroke-width="2"/><path d="M320 180 L176 96 M320 180 L470 110 M320 180 L452 278 M320 180 L190 270" class="f-none s-accent" stroke-width="2" stroke-dasharray="6 6"/><circle cx="320" cy="180" r="56" fill="url(#core)"/><text x="320" y="188" text-anchor="middle" font-size="22" font-weight="700" class="f-on-accent">Agent</text><circle cx="176" cy="96" r="26" class="f-cool"/><circle cx="470" cy="110" r="26" class="f-violet"/><circle cx="452" cy="278" r="26" class="f-warn"/><circle cx="190" cy="270" r="20" class="f-panel s-line" stroke-width="2"/><rect x="164" y="86" width="24" height="20" rx="4" class="f-none s-ink" stroke-width="2"/><path d="M460 110 h20 M470 100 v20" class="f-none s-ink" stroke-width="3"/><path d="M442 278 l8 8 l14 -16" class="f-none s-ink" stroke-width="3"/><text x="120" y="60" font-size="20" font-weight="600" class="f-ink">办公</text><text x="506" y="96" font-size="20" font-weight="600" class="f-ink">开发</text><text x="490" y="324" font-size="20" font-weight="600" class="f-ink">硬件</text><text x="120" y="320" font-size="18" class="f-muted">个人</text><circle cx="250" cy="70" r="4" class="f-accent"/><circle cx="560" cy="200" r="4" class="f-accent"/><circle cx="96" cy="190" r="4" class="f-muted"/></svg>"""

_COVER_TASK = """为这期{kind}（{period}）绘制「封面主视觉」横幅，viewBox 为 {viewbox}。页面会在图片上方用 HTML 显示标题和数据，所以图里不要写标题、日期、数字和句子。

要求：
- 用一个统一的视觉隐喻把本期 {trend_count} 个核心趋势组织成一张完整的画面（例如：多股数据流汇入同一个核心、三条增长曲线的赛跑、分层上升的阶梯、轨道系统、一张网络图），横向铺满画布。
- 每个趋势对应一个视觉主体，并配一个短标签（≤6 字，从趋势标题提炼），各主体用 accent / cool / violet / warn 区分，最重要的趋势用 accent 且最大。
- 增加细节层次：细网格或刻度线、连接线、小圆点粒子、1–2 个渐变色块，营造「情报终端」的精致质感。

本期核心趋势：
{trends}

报告正文（供理解，不要照抄）：
{content}"""

_TREND_TASK = """为简报中的这个趋势绘制一张「概念示意图」，viewBox 为 {viewbox}。

要求：
- 先想清楚这个趋势的核心机制是什么（谁在变、从什么变成什么、驱动力是什么），再选一个最贴切的图形隐喻表达它。
- 2–4 个短标签（每个 ≤6 字），点出图中关键角色或阶段；不要写标题，不要写句子。
- 画面饱满、主次分明：一个视觉焦点用 accent，其余用 cool/violet/warn/muted 和细线。

趋势标题：{title}

趋势相关内容：
{context}"""


def _trend_context(content: str, title: str, limit: int = 1500) -> str:
    idx = content.find(title)
    if idx < 0:
        return content[:limit]
    return content[idx: idx + limit]


class SummaryIllustrator:
    """调用 LLM 为总结报告生成封面图和趋势插图（各图并行生成）"""

    def __init__(self, ai_analyzer, max_workers: int = 5, timeout: float = 900.0):
        self.ai_analyzer = ai_analyzer
        self.max_workers = max_workers
        self.timeout = timeout

    def _draw(self, task: str, canvas: ArtCanvas, purpose: str) -> Optional[str]:
        messages = [
            {"role": "system", "content": _STYLE_GUIDE.format(**canvas.prompt_params())},
            {"role": "user", "content": task},
        ]
        try:
            # 推理模型的思考 token 也计入 max_tokens，预算需远大于 SVG 本身
            raw = self.ai_analyzer._chat_completion_text(
                messages,
                temperature=0.6,
                max_tokens=MAX_COMPLETION_TOKENS,
                purpose=purpose,
                timeout=self.timeout,
                max_retries=4,
            )
        except Exception as exc:
            logger.warning(f"配图生成失败 [{purpose}]: {exc}")
            return None
        svg = sanitize_svg(raw, canvas.viewbox)
        if not svg:
            logger.warning(f"配图输出无效 [{purpose}]，长度 {len(raw or '')}")
        return svg

    def generate(
        self,
        content: str,
        *,
        summary_type: str,
        period_label: str,
        total_articles: int,
        high_importance: int,
    ) -> Dict[str, Any]:
        trends = extract_trend_titles(content)
        kind = "周报" if summary_type == "weekly" else "日报"
        cover_task = _COVER_TASK.format(
            kind=kind,
            viewbox=COVER_VIEWBOX,
            period=period_label,
            trend_count=len(trends) or "若干",
            total=total_articles,
            high=high_importance,
            trends="\n".join(f"{i + 1}. {t}" for i, t in enumerate(trends)) or "（未识别到趋势，请从正文提炼）",
            content=content[:5000],
        )
        jobs = [(cover_task, COVER_CANVAS, "summary_illustration_cover")]
        for i, title in enumerate(trends):
            task = _TREND_TASK.format(viewbox=TREND_VIEWBOX, title=title, context=_trend_context(content, title))
            jobs.append((task, TREND_CANVAS, f"summary_illustration_trend_{i + 1}"))

        with ThreadPoolExecutor(max_workers=min(self.max_workers, len(jobs))) as pool:
            results = list(pool.map(lambda job: self._draw(*job), jobs))

        return {
            "version": ILLUSTRATION_VERSION,
            "cover": results[0],
            "trends": [{"title": title, "svg": svg} for title, svg in zip(trends, results[1:])],
            "model": getattr(self.ai_analyzer, "model", None),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }


def period_label_for(summary_type: str, start_date: datetime, end_date: datetime) -> str:
    if summary_type == "weekly":
        return f"{start_date:%Y.%m.%d} – {end_date:%m.%d} 周报"
    return f"{start_date:%Y.%m.%d} 日报"


def illustrate_summary(db, summary_id: int, ai_analyzer) -> Optional[Dict[str, Any]]:
    """为指定总结生成配图并写回数据库；总结不存在时返回 None"""
    from backend.app.db.models import DailySummary

    with db.get_session() as session:
        row = session.query(DailySummary).filter(DailySummary.id == summary_id).first()
        if not row:
            return None
        content = row.summary_content or ""
        options = {
            "summary_type": row.summary_type,
            "period_label": period_label_for(row.summary_type, row.start_date, row.end_date),
            "total_articles": row.total_articles or 0,
            "high_importance": row.high_importance_count or 0,
        }

    from backend.app.core.settings import settings
    from backend.app.utils.factories import resolve_illustration_analyzer

    illustrator = SummaryIllustrator(
        resolve_illustration_analyzer(ai_analyzer),
        max_workers=settings.SUMMARY_ILLUSTRATION_CONCURRENCY,
        timeout=settings.SUMMARY_ILLUSTRATION_TIMEOUT,
    )
    illustrations = illustrator.generate(content, **options)
    if not has_any_art(illustrations):
        return illustrations

    with db.get_session() as session:
        row = session.query(DailySummary).filter(DailySummary.id == summary_id).first()
        if not row:
            return None
        row.illustrations = illustrations
    return illustrations


def has_any_art(illustrations: Optional[Dict[str, Any]]) -> bool:
    if not illustrations:
        return False
    return bool(illustrations.get("cover")) or any(t.get("svg") for t in illustrations.get("trends", []))


# ---------------------------------------------------------------------------
# 后台任务：配图耗时可达数分钟，不能占住 HTTP 请求或总结生成流程
# ---------------------------------------------------------------------------

_jobs_lock = threading.Lock()
_running_jobs: set = set()
_job_errors: Dict[int, str] = {}


def illustration_status(summary_id: int) -> Dict[str, Any]:
    with _jobs_lock:
        return {"running": summary_id in _running_jobs, "error": _job_errors.get(summary_id)}


def start_illustration(db, summary_id: int, ai_analyzer) -> bool:
    """在后台线程生成配图；该总结已有任务在跑时返回 False"""
    with _jobs_lock:
        if summary_id in _running_jobs:
            return False
        _running_jobs.add(summary_id)
        _job_errors.pop(summary_id, None)
    threading.Thread(
        target=_run_illustration_job,
        args=(db, summary_id, ai_analyzer),
        name=f"summary-art-{summary_id}",
        daemon=True,
    ).start()
    return True


def _run_illustration_job(db, summary_id: int, ai_analyzer) -> None:
    error: Optional[str] = None
    try:
        result = illustrate_summary(db, summary_id, ai_analyzer)
        if result is None:
            error = "摘要不存在"
        elif not has_any_art(result):
            error = "模型未返回有效的 SVG 配图"
        else:
            drawn = sum(1 for t in result["trends"] if t.get("svg"))
            logger.info(f"🎨 总结配图完成 (ID: {summary_id}) 封面: {bool(result['cover'])} 趋势图: {drawn}")
    except Exception as exc:
        logger.error(f"总结配图失败 (ID: {summary_id}): {exc}", exc_info=True)
        error = str(exc) or type(exc).__name__
    finally:
        with _jobs_lock:
            _running_jobs.discard(summary_id)
            if error:
                _job_errors[summary_id] = error
    if error:
        logger.warning(f"⚠️  总结配图未生成 (ID: {summary_id}): {error}")
