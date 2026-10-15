/**
 * 把 LLM 生成的总结 Markdown 解析成结构化简报。
 * 趋势识别规则与后端 services/collector/summary_illustrator.py 保持一致（配图按趋势顺序对应）。
 * 识别不了的段落保留为 Markdown，保证自定义提示词的输出也能完整展示。
 */

export interface DigestRef {
  label: string;
  ids: number[];
}

export interface DigestArticle {
  id: number | null;
  title: string;
  source: string | null;
  text: string;
}

export type DigestPartKind = 'what' | 'why' | 'impact' | 'other';

export interface DigestPart {
  label: string;
  kind: DigestPartKind;
  text: string;
}

export interface DigestTrend {
  title: string;
  text: string;
  parts: DigestPart[];
  refs: DigestRef[];
}

export interface DigestBlock {
  title: string;
  markdown: string;
}

export interface SummaryDigest {
  title: string | null;
  lede: string[];
  articles: DigestArticle[];
  trends: DigestTrend[];
  outlook: string[];
  extras: DigestBlock[];
}

type SectionKind = 'articles' | 'trends' | 'lede' | 'outlook' | 'other';

interface Section {
  title: string;
  level: number;
  lines: string[];
  nested?: boolean;
}

interface ListNode {
  indent: number;
  text: string;
  extra: string[];
  children: ListNode[];
}

const HEADING_MD = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const HEADING_BOLD = /^\*\*(.+?)\*\*\s*$/;
const BOLD_SECTION = /^[【[]|^[一二三四五六七八九十\d]+\s*[、.．]/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)、])\s+(.*)$/;
const LEAD_BOLD = /^\*\*(.+?)\*\*\s*[:：]?\s*(.*)$/;
const LABEL_BOLD = /^\*\*(.+?)\*\*\s*[:：]\s*(.*)$/;
const TREND_PREFIX = /^(?:[（(]可选[)）])?\s*趋势\s*[一二三四五六七八九十\d]+\s*[：:]\s*/;
const ARTICLE_ITEM = /^\[\*{0,2}(.+?)\*{0,2}\]\(([^)]*)\)\s*(.*)$/;
const SOURCE_SUFFIX = /\s*[（(]([^（）()]+)[)）]\s*$/;
const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

function cleanHeading(title: string): string {
  return title
    .replace(EMOJI, '')
    .replace(/\*\*/g, '')
    .replace(/^[一二三四五六七八九十\d]+\s*[、.．]\s*/, '')
    .replace(/\s*[（(][A-Za-z][A-Za-z\s&/-]*[)）]\s*$/, '')
    .trim();
}

function classify(title: string): SectionKind {
  if (/文章|要闻|头条|新闻/.test(title) && !/总结|周报|日报/.test(title)) return 'articles';
  if (/趋势|洞察|热点/.test(title)) return 'trends';
  if (/摘要|概览|速览|要点|核心|导读/.test(title)) return 'lede';
  if (/展望|关注|建议|预测|下周|未来/.test(title)) return 'outlook';
  return 'other';
}

function splitSections(content: string): { title: string | null; sections: Section[] } {
  let docTitle: string | null = null;
  const sections: Section[] = [];
  let current: Section = { title: '', level: 0, lines: [] };

  content.replace(/\r\n/g, '\n').split('\n').forEach((raw) => {
    if (/^\s*-{3,}\s*$/.test(raw)) return;
    const md = HEADING_MD.exec(raw);
    const bold = /^\s/.test(raw) ? null : HEADING_BOLD.exec(raw);
    let title: string | null = null;
    let level = 2;
    if (md) {
      title = md[2];
      level = md[1].length;
    } else if (bold && BOLD_SECTION.test(bold[1].trim())) {
      title = bold[1];
      level = /^[【[]/.test(bold[1].trim()) ? 1 : 2;
    }
    if (title === null) {
      current.lines.push(current.nested && raw.trim() ? `  ${raw}` : raw);
      return;
    }
    const isDocTitle = level === 1 && docTitle === null && sections.length === 0 && !current.lines.some((l) => l.trim());
    if (isDocTitle) {
      docTitle = cleanHeading(title).replace(/^[【[]|[】\]]$/g, '').trim();
      return;
    }
    // 文章/趋势章节下的子标题：文章分组标题丢弃；趋势子标题转成列表项，正文缩进挂到该项下
    const parentKind = current.title ? classify(current.title) : 'other';
    if (md && current.level > 0 && level > current.level && (parentKind === 'articles' || parentKind === 'trends')) {
      if (parentKind === 'trends') {
        current.lines.push(`- **${cleanHeading(title)}**`);
        current.nested = true;
      }
      return;
    }
    sections.push(current);
    current = { title: title.trim(), level, lines: [] };
  });
  sections.push(current);
  return { title: docTitle, sections: sections.filter((s) => s.title || s.lines.some((l) => l.trim())) };
}

function parseList(lines: string[]): { nodes: ListNode[]; paragraphs: string[] } {
  const root: ListNode = { indent: -1, text: '', extra: [], children: [] };
  const stack: ListNode[] = [root];
  const paragraphs: string[] = [];

  lines.forEach((line) => {
    if (!line.trim()) return;
    const m = LIST_ITEM.exec(line);
    if (m) {
      const indent = m[1].replace(/\t/g, '    ').length;
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
      const node: ListNode = { indent, text: m[2].trim(), extra: [], children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      return;
    }
    const top = stack[stack.length - 1];
    if (top === root) paragraphs.push(line.trim());
    else top.extra.push(line.trim());
  });
  return { nodes: root.children, paragraphs };
}

function nodeText(node: ListNode, withChildren = true): string {
  const parts = [node.text, ...node.extra];
  if (withChildren) node.children.forEach((child) => parts.push(nodeText(child)));
  return parts.filter(Boolean).join(' ').trim();
}

export function stripInline(text: string): string {
  return text
    .replace(LINK, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRefIds(href: string): number[] {
  const ids: number[] = [];
  const share = /\/(?:share|article)\/(\d+)/.exec(href);
  if (share) ids.push(Number(share[1]));
  for (const m of href.matchAll(/ID\s*[:：]\s*(\d+)/gi)) ids.push(Number(m[1]));
  return [...new Set(ids)];
}

function collectRefs(text: string): DigestRef[] {
  const refs: DigestRef[] = [];
  for (const m of text.matchAll(LINK)) {
    const ids = parseRefIds(m[2]);
    if (ids.length) refs.push({ label: stripInline(m[1]), ids });
  }
  return refs;
}

export function cleanTrendTitle(text: string): string {
  return stripInline(text.replace(TREND_PREFIX, '')).replace(/^[[【]|[\]】]$/g, '').trim();
}

function partKind(label: string): DigestPartKind {
  if (/现象|发生|事件|背景|事实/.test(label)) return 'what';
  if (/解读|意味|原因|驱动|逻辑|分析/.test(label)) return 'why';
  if (/影响|机遇|机会|挑战|启示|建议/.test(label)) return 'impact';
  return 'other';
}

function toTrend(node: ListNode): DigestTrend | null {
  const lead = LEAD_BOLD.exec(node.text);
  let title: string;
  let rest: string;
  if (lead) {
    title = cleanTrendTitle(lead[1]);
    rest = lead[2];
  } else {
    const plain = stripInline(node.text);
    const cut = plain.search(/[：:。]/);
    if (cut <= 0 || cut > 40) return null;
    title = plain.slice(0, cut);
    rest = plain.slice(cut + 1);
  }
  if (!title) return null;

  const textParts = [rest, ...node.extra].filter(Boolean);
  const parts: DigestPart[] = [];
  node.children.forEach((child) => {
    const label = LABEL_BOLD.exec(child.text);
    if (label) {
      const body = [label[2], ...child.extra, ...child.children.map((c) => nodeText(c))].filter(Boolean).join(' ');
      parts.push({ label: stripInline(label[1]), kind: partKind(label[1]), text: body.trim() });
    } else {
      textParts.push(nodeText(child));
    }
  });
  const text = textParts.join(' ').trim();
  return {
    title,
    text,
    parts,
    refs: collectRefs([text, ...parts.map((p) => p.text)].join(' ')),
  };
}

function toArticle(node: ListNode): DigestArticle | null {
  const m = ARTICLE_ITEM.exec(node.text);
  if (!m) return null;
  const rawTitle = stripInline(m[1]);
  const source = SOURCE_SUFFIX.exec(rawTitle);
  const ids = parseRefIds(m[2]);
  return {
    id: ids[0] ?? null,
    title: source ? rawTitle.slice(0, source.index).trim() : rawTitle,
    source: source ? source[1].trim() : null,
    text: [m[3], ...node.extra, ...node.children.map((c) => nodeText(c))].filter(Boolean).join(' ').trim(),
  };
}

function sectionMarkdown(section: Section): DigestBlock {
  return { title: cleanHeading(section.title), markdown: section.lines.join('\n').trim() };
}

export function parseSummary(content: string): SummaryDigest {
  const digest: SummaryDigest = { title: null, lede: [], articles: [], trends: [], outlook: [], extras: [] };
  if (!content?.trim()) return digest;

  const { title, sections } = splitSections(content);
  digest.title = title;

  sections.forEach((section) => {
    const kind = classify(section.title);
    const { nodes, paragraphs } = parseList(section.lines);

    if (kind === 'articles') {
      const articles = nodes.map(toArticle).filter((a): a is DigestArticle => a !== null);
      if (articles.length) {
        digest.articles.push(...articles);
        return;
      }
    }
    if (kind === 'trends') {
      const trends = nodes.map(toTrend).filter((t): t is DigestTrend => t !== null);
      if (trends.length) {
        digest.trends.push(...trends);
        return;
      }
    }
    if (kind === 'lede' || kind === 'outlook') {
      const texts = [...paragraphs, ...nodes.map((n) => nodeText(n))].filter(Boolean);
      if (texts.length) {
        digest[kind].push(...texts);
        return;
      }
    }
    const block = sectionMarkdown(section);
    if (block.markdown) digest.extras.push(block);
  });

  return digest;
}

/** 取第一句作为要点（去掉 Markdown 标记） */
export function firstSentence(text: string, max = 90): string {
  const plain = stripInline(text);
  const m = /^(.+?[。！？!?；;])/.exec(plain);
  const sentence = m ? m[1] : plain;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

export function isStructured(digest: SummaryDigest): boolean {
  return digest.trends.length > 0 || digest.articles.length > 0 || digest.lede.length > 0;
}

export function digestHeadline(digest: SummaryDigest): string | null {
  return digest.trends[0]?.title ?? digest.articles[0]?.title ?? null;
}

/** 文章来源分布（按出现次数降序） */
export function sourceBreakdown(articles: DigestArticle[]): { source: string; count: number }[] {
  const counts = new Map<string, number>();
  articles.forEach((a) => {
    const key = a.source || '其他';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
}
