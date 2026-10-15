import threading
import time
from types import SimpleNamespace

from backend.app.services.collector import summary_illustrator as si
from backend.app.services.collector.summary_illustrator import (
    SummaryIllustrator,
    extract_article_titles,
    extract_headline,
    extract_trend_titles,
    sanitize_svg,
)

DAILY = """# 📊 2026年10月09日AI新闻总结

## 🔥 重点文章

- [**TRAE终于把Code和Work合并了（量子位）**](/share/23368)  
  TRAE将TraeCode与TraeWork融合为统一平台。

- [**Anthropic为开源项目推出免费AI安全扫描服务（TheVerge）**](/share/23327)  
  Anthropic推出OSS Scanner。

## 📌 重要趋势

1. **AI智能体（Agent）进入企业落地爆发期**  
   多家公司集中发布或整合Agent平台。

2. **AI安全与治理争议加剧，学术界与产业界出现裂痕**  
   OpenAI因数学证明发布方式遭抵制。
"""

WEEKLY = """**【人工智能行业风向洞察周报 | 2026年10月03日 至 2026年10月09日】**

**一、 本周核心摘要 (Executive Summary)**
*   **AI智能体（Agent）已从概念验证迈入规模化落地与商业竞争的新阶段**，各大巨头展开“三国杀”。

**二、 本周关键趋势洞察 (Key Trends Insight)**

*   **趋势一：AI智能体进入“原生构建”与“生态卡位”时代**
    *   **现象描述**：由本周[OpenAI发布Dots](ID: 23134)等事件共同指向。
    *   **趋势解读**：这反映出行业竞争的焦点正在转移。

*   **趋势二：消费级AI面临“叫好不叫座”的经济困境**
    *   **现象描述**：本周[a16z报告](ID: 259)指出仅2.2%家庭付费。

**三、 未来展望 (Future Outlook)**
*   综合本周观察，行业需要密切关注 TechCrunch Disrupt 2026 大会。
"""


def test_extract_daily_structure():
    assert extract_trend_titles(DAILY) == [
        "AI智能体（Agent）进入企业落地爆发期",
        "AI安全与治理争议加剧，学术界与产业界出现裂痕",
    ]
    assert extract_article_titles(DAILY) == [
        "TRAE终于把Code和Work合并了",
        "Anthropic为开源项目推出免费AI安全扫描服务",
    ]
    assert extract_headline(DAILY) == "AI智能体（Agent）进入企业落地爆发期"


def test_extract_weekly_trends_strip_prefix_and_ignore_nested_labels():
    assert extract_trend_titles(WEEKLY) == [
        "AI智能体进入“原生构建”与“生态卡位”时代",
        "消费级AI面临“叫好不叫座”的经济困境",
    ]


def test_extract_headline_falls_back_to_none_for_free_text():
    assert extract_headline("今天没有什么新闻。") is None
    assert extract_trend_titles("") == []


def test_sanitize_strips_scripts_handlers_and_external_refs():
    raw = """好的，这是图：
```svg
<svg viewBox="0 0 10 10" width="100" onload="alert(1)">
  <script>alert(1)</script>
  <foreignObject><div>x</div></foreignObject>
  <image href="http://evil/x.png"/>
  <rect class="f-accent" x="1" y="1" width="5" height="5" onclick="x()" style="fill:url(http://evil)"/>
  <use href="#a"/><use href="http://evil#a"/>
  <text class="f-ink" x="2" y="8">标签</text>
</svg>
```"""
    svg = sanitize_svg(raw, "0 0 10 10")
    assert svg is not None
    lowered = svg.lower()
    for bad in ("script", "foreignobject", "<image", "onload", "onclick", "evil", 'width="100"'):
        assert bad not in lowered
    assert 'class="f-accent"' in svg
    assert "标签" in svg
    assert 'href="#a"' in svg
    assert svg.startswith("<svg")


def test_sanitize_rejects_invalid_and_entity_payloads():
    assert sanitize_svg("no svg here", "0 0 1 1") is None
    assert sanitize_svg("<svg><g></svg>", "0 0 1 1") is None
    outside = sanitize_svg('<!DOCTYPE x [<!ENTITY a "b">]><svg><rect/></svg>', "0 0 1 1")
    assert outside is not None and "ENTITY" not in outside and "DOCTYPE" not in outside
    assert sanitize_svg('<svg><!ENTITY a "b"><rect/></svg>', "0 0 1 1") is None


def test_sanitize_adds_default_viewbox():
    svg = sanitize_svg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>', "0 0 640 360")
    assert 'viewBox="0 0 640 360"' in svg


def test_generate_draws_cover_and_one_image_per_trend():
    calls = []

    def fake_completion(messages, **kwargs):
        calls.append(kwargs["purpose"])
        if kwargs["purpose"].endswith("trend_2"):
            raise RuntimeError("boom")
        return '<svg viewBox="0 0 1 1"><circle class="f-accent" r="1"/></svg>'

    analyzer = SimpleNamespace(model="m", _chat_completion_text=fake_completion)
    result = SummaryIllustrator(analyzer).generate(
        WEEKLY, summary_type="weekly", period_label="W41", total_articles=10, high_importance=3
    )

    assert sorted(calls) == [
        "summary_illustration_cover",
        "summary_illustration_trend_1",
        "summary_illustration_trend_2",
    ]
    assert result["cover"].startswith("<svg")
    assert [t["title"] for t in result["trends"]] == extract_trend_titles(WEEKLY)
    assert result["trends"][0]["svg"] and result["trends"][1]["svg"] is None
    assert result["model"] == "m"


def test_draw_passes_long_timeout_and_reasoning_budget():
    seen = {}

    def fake_completion(messages, **kwargs):
        seen.update(kwargs)
        return '<svg viewBox="0 0 1 1"><rect/></svg>'

    analyzer = SimpleNamespace(model="m", _chat_completion_text=fake_completion)
    SummaryIllustrator(analyzer, timeout=123)._draw("task", "0 0 1 1", "p")

    assert seen["timeout"] == 123
    assert seen["max_tokens"] >= 16000


def test_illustration_analyzer_falls_back_to_summary_model(monkeypatch):
    from backend.app.utils import factories

    default = SimpleNamespace(model="summary-model")
    monkeypatch.setattr(factories.settings, "get_illustration_provider_config", lambda: None)
    assert factories.resolve_illustration_analyzer(default) is default

    anthropic = {"id": 1, "name": "c", "protocol": "anthropic", "api_key": "k", "api_base": "b", "selected_model": "m"}
    monkeypatch.setattr(factories.settings, "get_illustration_provider_config", lambda: anthropic)
    assert factories.resolve_illustration_analyzer(default) is default


def test_illustration_analyzer_uses_dedicated_model(monkeypatch):
    from backend.app.utils import factories

    config = {
        "id": 2,
        "name": "art",
        "protocol": "openai_compatible",
        "api_key": "k",
        "api_base": "http://127.0.0.1:1/v1",
        "selected_model": "art-model",
    }
    monkeypatch.setattr(factories.settings, "get_illustration_provider_config", lambda: config)
    analyzer = factories.resolve_illustration_analyzer(SimpleNamespace(model="summary-model"))
    assert analyzer.model == "art-model"
    assert str(analyzer.client.base_url).startswith("http://127.0.0.1:1/v1")


def test_background_job_reports_running_then_error(monkeypatch):
    gate = threading.Event()

    def fake_illustrate(db, summary_id, analyzer):
        gate.wait(5)
        return {"cover": None, "trends": []}

    monkeypatch.setattr(si, "illustrate_summary", fake_illustrate)

    assert si.start_illustration(None, 999, None) is True
    assert si.illustration_status(999) == {"running": True, "error": None}
    assert si.start_illustration(None, 999, None) is False

    gate.set()
    for _ in range(50):
        if not si.illustration_status(999)["running"]:
            break
        time.sleep(0.05)
    assert si.illustration_status(999) == {"running": False, "error": "模型未返回有效的 SVG 配图"}
