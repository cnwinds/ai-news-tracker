import { describe, expect, it } from 'vitest';
import { digestHeadline, firstSentence, isStructured, parseSummary, sourceBreakdown } from './parse';

const DAILY = `# 📊 2026年10月09日AI新闻总结

## 🔥 重点文章

- [**TRAE终于把Code和Work合并了（量子位）**](/share/23368)  
  TRAE将TraeCode与TraeWork融合为统一平台。

- [**Anthropic为开源项目推出免费AI安全扫描服务（TheVerge）**](/share/23327)  
  Anthropic推出OSS Scanner。

- [**谷歌发布办公Agent，支持调用Claude（量子位）**](/share/23338)  
  谷歌推出Gemini Agent。

## 📌 重要趋势

1. **AI智能体（Agent）进入企业落地爆发期**  
   多家公司集中发布或整合Agent平台。Agent不再仅是技术演示。

2. **AI安全与治理争议加剧**  
   OpenAI因数学证明发布方式遭抵制。
`;

const WEEKLY = `**【人工智能行业风向洞察周报 | 2026年10月03日 至 2026年10月09日】**

**一、 本周核心摘要 (Executive Summary)**
*   **AI智能体已迈入规模化落地的新阶段**，各大巨头展开“三国杀”。

**二、 本周关键趋势洞察 (Key Trends Insight)**

*   **趋势一：AI智能体进入“原生构建”时代**
    *   **现象描述**：由本周[OpenAI发布Dots](ID: 23134)、[谷歌推出Gemini企业级Agent](ID: 23338, ID: 296)等事件共同指向。
    *   **趋势解读**：这反映出竞争焦点正在转移。
    *   **潜在影响与机遇**：短期来看，SaaS 厂商受到冲击。

*   **趋势二：消费级AI面临经济困境**
    *   **现象描述**：本周[a16z报告](ID: 259)指出仅2.2%家庭付费。

**三、 未来展望 (Future Outlook)**
*   综合本周观察，行业需要密切关注 TechCrunch Disrupt 大会。
`;

describe('parseSummary', () => {
  it('parses daily brief into articles and trends', () => {
    const digest = parseSummary(DAILY);
    expect(digest.title).toBe('2026年10月09日AI新闻总结');
    expect(digest.articles).toHaveLength(3);
    expect(digest.articles[0]).toEqual({
      id: 23368,
      title: 'TRAE终于把Code和Work合并了',
      source: '量子位',
      text: 'TRAE将TraeCode与TraeWork融合为统一平台。',
    });
    expect(digest.trends.map((t) => t.title)).toEqual(['AI智能体（Agent）进入企业落地爆发期', 'AI安全与治理争议加剧']);
    expect(digest.trends[0].text).toContain('多家公司');
    expect(digest.extras).toEqual([]);
    expect(digestHeadline(digest)).toBe('AI智能体（Agent）进入企业落地爆发期');
    expect(sourceBreakdown(digest.articles)).toEqual([
      { source: '量子位', count: 2 },
      { source: 'TheVerge', count: 1 },
    ]);
  });

  it('parses weekly report sections, labelled parts and references', () => {
    const digest = parseSummary(WEEKLY);
    expect(digest.title).toBe('人工智能行业风向洞察周报 | 2026年10月03日 至 2026年10月09日');
    expect(digest.lede).toHaveLength(1);
    expect(digest.trends.map((t) => t.title)).toEqual(['AI智能体进入“原生构建”时代', '消费级AI面临经济困境']);
    expect(digest.trends[0].parts.map((p) => p.kind)).toEqual(['what', 'why', 'impact']);
    expect(digest.trends[0].refs).toEqual([
      { label: 'OpenAI发布Dots', ids: [23134] },
      { label: '谷歌推出Gemini企业级Agent', ids: [23338, 296] },
    ]);
    expect(digest.outlook[0]).toContain('TechCrunch');
    expect(digest.extras).toEqual([]);
  });

  it('keeps unknown content as markdown blocks', () => {
    const digest = parseSummary('## 随便聊聊\n\n今天天气不错。');
    expect(isStructured(digest)).toBe(false);
    expect(digest.extras).toEqual([{ title: '随便聊聊', markdown: '今天天气不错。' }]);
  });

  it('extracts first sentence without markdown', () => {
    expect(firstSentence('**重点**在于[链接](ID: 1)。后面的话')).toBe('重点在于链接。');
  });
});
